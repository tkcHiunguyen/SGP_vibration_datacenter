import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { DataExportJob } from '../data-export/data-export-job.repository.js';
import type { SgpDataExportService } from './sgpdata-export.service.js';
import type { SgpDataImportService } from './sgpdata-import.service.js';
import type { SgpDataImportJob } from './sgpdata.types.js';

type SgpDataRoutesDeps = {
  app: FastifyInstance;
  importService: SgpDataImportService;
  exportService: SgpDataExportService;
  authorize: (request: FastifyRequest, reply: FastifyReply, role: 'admin' | 'viewer') => string | null;
};

const jobParamsSchema = z.object({ jobId: z.string().min(1) });
const uploadParamsSchema = z.object({ uploadId: z.string().min(1) });
const listSchema = z.object({ limit: z.coerce.number().int().positive().max(100).optional() });
const importJobSchema = z.object({
  uploadId: z.string().min(1),
  mode: z.enum(['merge', 'idempotent']).default('merge'),
});
const exportJobSchema = z.object({
  date_from: z.string().min(1),
  date_to: z.string().min(1),
  deviceId: z.string().min(1).optional(),
});

function parseRange(from: string, to: string): { from: string; to: string } | null {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

function processedRecords(job: SgpDataImportJob): number {
  return job.processed.devices + job.processed.measurements + job.processed.spectrum + job.processed.placementConfigs;
}

function totalRecords(job: SgpDataImportJob): number {
  return job.totals.devices + job.totals.measurements + job.totals.spectrum + job.totals.placementConfigs;
}

function publicImportPreview(job: SgpDataImportJob) {
  if (!job.preview) return undefined;
  const { deviceMetadata: _deviceMetadata, placementConfigs: _placementConfigs, ...preview } = job.preview;
  return preview;
}

function importJobDetail(job: SgpDataImportJob) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.parse(job.completedAt ?? new Date().toISOString()) - Date.parse(job.startedAt ?? job.createdAt)) / 1_000));
  return {
    jobId: job.jobId,
    uploadId: job.uploadId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    overallProgress: job.progress,
    stageProgress: job.stageProgress,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    mode: job.mode,
    totals: job.totals,
    processed: job.processed,
    processedRecords: processedRecords(job),
    totalRecords: totalRecords(job),
    inserted: job.mutations.inserted,
    updated: job.mutations.updated,
    skipped: job.mutations.skipped,
    failed: job.mutations.failed,
    currentDeviceId: job.currentDeviceId,
    recordsPerSecond: job.recordsPerSecond,
    estimatedSecondsRemaining: job.estimatedSecondsRemaining,
    elapsedSeconds,
    preview: publicImportPreview(job),
    devices: Object.values(job.devices),
    events: job.events.slice(-20),
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
  };
}

function importJobSummary(job: SgpDataImportJob) {
  const detail = importJobDetail(job);
  const { devices: _devices, events: _events, preview: _preview, ...summary } = detail;
  return summary;
}

function exportJobResponse(job: DataExportJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    range: job.range,
    deviceId: job.deviceId,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    error: job.error,
    manifest: job.manifest,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
  };
}

function importError(error: unknown): string {
  if (error instanceof z.ZodError) return 'sgpdata_schema_invalid';
  return error instanceof Error ? error.message : 'sgpdata_invalid';
}

export function registerSgpDataRoutes({ app, importService, exportService, authorize }: SgpDataRoutesDeps): void {
  app.post('/api/sgpdata/import/uploads', async (request, reply) => {
    const actor = authorize(request, reply, 'admin');
    if (!actor) return;
    const multipartRequest = request as FastifyRequest & {
      file: () => Promise<{ filename: string; file: Readable } | undefined>;
    };
    const part = await multipartRequest.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'sgpdata_file_required' });
    try {
      const job = await importService.storeUpload({ fileName: part.filename, stream: part.file, createdBy: actor });
      return reply.code(201).send({ ok: true, data: importJobDetail(job) });
    } catch (error) {
      return reply.code(422).send({ ok: false, error: importError(error) });
    }
  });

  app.get('/api/sgpdata/import/uploads/:uploadId/preview', async (request, reply) => {
    if (!authorize(request, reply, 'viewer')) return;
    const params = uploadParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.code(422).send({ ok: false, error: 'sgpdata_upload_id_required' });
    const job = await importService.getPreview(params.data.uploadId);
    if (!job) return reply.code(404).send({ ok: false, error: 'sgpdata_upload_not_found' });
    if (!job.preview) return reply.code(409).send({ ok: false, error: 'sgpdata_preview_not_ready', data: importJobDetail(job) });
    return reply.send({
      ok: true,
      data: { ...publicImportPreview(job), uploadId: job.uploadId, jobId: job.jobId, file: { name: job.fileName, sizeBytes: job.sizeBytes } },
    });
  });

  app.post('/api/sgpdata/import/jobs', async (request, reply) => {
    if (!authorize(request, reply, 'admin')) return;
    const body = importJobSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(422).send({ ok: false, error: 'sgpdata_import_job_invalid' });
    try {
      const job = await importService.createJob(body.data.uploadId, body.data.mode);
      return reply.code(202).send({ ok: true, data: importJobDetail(job) });
    } catch (error) {
      const code = importError(error);
      return reply.code(code === 'sgpdata_upload_not_found' ? 404 : 409).send({ ok: false, error: code });
    }
  });

  app.get('/api/sgpdata/import/jobs', async (request, reply) => {
    if (!authorize(request, reply, 'viewer')) return;
    const query = listSchema.safeParse(request.query ?? {});
    if (!query.success) return reply.code(422).send({ ok: false, error: 'sgpdata_import_job_query_invalid' });
    const jobs = await importService.listJobs(query.data.limit ?? 20);
    return reply.send({ ok: true, data: { items: jobs.map(importJobSummary) } });
  });

  app.get('/api/sgpdata/import/jobs/:jobId', async (request, reply) => {
    if (!authorize(request, reply, 'viewer')) return;
    const params = jobParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.code(422).send({ ok: false, error: 'sgpdata_job_id_required' });
    const job = await importService.getJob(params.data.jobId);
    if (!job) return reply.code(404).send({ ok: false, error: 'sgpdata_import_job_not_found' });
    return reply.send({ ok: true, data: importJobDetail(job) });
  });

  app.post('/api/sgpdata/export/jobs', async (request, reply) => {
    const actor = authorize(request, reply, 'admin');
    if (!actor) return;
    const body = exportJobSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(422).send({ ok: false, error: 'sgpdata_date_range_required' });
    const range = parseRange(body.data.date_from, body.data.date_to);
    if (!range) return reply.code(422).send({ ok: false, error: 'sgpdata_date_range_invalid' });
    try {
      const job = await exportService.createJob({ range, deviceId: body.data.deviceId, createdBy: actor });
      return reply.code(202).send({ ok: true, data: exportJobResponse(job) });
    } catch (error) {
      const code = importError(error);
      return reply.code(code === 'device_not_found' ? 404 : 422).send({ ok: false, error: code });
    }
  });

  app.get('/api/sgpdata/export/jobs', async (request, reply) => {
    if (!authorize(request, reply, 'viewer')) return;
    const query = listSchema.safeParse(request.query ?? {});
    if (!query.success) return reply.code(422).send({ ok: false, error: 'sgpdata_export_job_query_invalid' });
    const jobs = await exportService.listJobs(query.data.limit ?? 20);
    return reply.send({ ok: true, data: { items: jobs.map(exportJobResponse) } });
  });

  app.get('/api/sgpdata/export/jobs/:jobId', async (request, reply) => {
    if (!authorize(request, reply, 'viewer')) return;
    const params = jobParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.code(422).send({ ok: false, error: 'sgpdata_job_id_required' });
    const job = await exportService.getJob(params.data.jobId);
    if (!job) return reply.code(404).send({ ok: false, error: 'sgpdata_export_job_not_found' });
    return reply.send({ ok: true, data: exportJobResponse(job) });
  });

  app.get('/api/sgpdata/export/jobs/:jobId/download', async (request, reply) => {
    if (!authorize(request, reply, 'admin')) return;
    const params = jobParamsSchema.safeParse(request.params ?? {});
    if (!params.success) return reply.code(422).send({ ok: false, error: 'sgpdata_job_id_required' });
    const job = await exportService.getJob(params.data.jobId);
    if (!job) return reply.code(404).send({ ok: false, error: 'sgpdata_export_job_not_found' });
    if (job.status !== 'completed' || !job.filePath || !job.fileName) {
      return reply.code(409).send({ ok: false, error: 'sgpdata_export_job_not_ready', data: exportJobResponse(job) });
    }
    const fileStat = await stat(job.filePath).catch(() => null);
    if (!fileStat?.isFile()) return reply.code(404).send({ ok: false, error: 'sgpdata_export_file_not_found' });
    reply.header('content-type', 'application/vnd.sgpdata');
    reply.header('content-disposition', `attachment; filename="${job.fileName}"`);
    reply.header('cache-control', 'no-store');
    reply.header('content-length', String(job.sizeBytes ?? fileStat.size));
    return reply.send(createReadStream(job.filePath));
  });

  app.get('/api/sgpdata/export', async (_request, reply) => {
    return reply.code(410).send({ ok: false, error: 'sgpdata_sync_export_deprecated', use: '/api/sgpdata/export/jobs' });
  });

  app.post('/api/sgpdata/import/preview', async (_request, reply) => {
    return reply.code(410).send({ ok: false, error: 'sgpdata_preview_upload_deprecated', use: '/api/sgpdata/import/uploads' });
  });

  app.post('/api/sgpdata/import', async (_request, reply) => {
    return reply.code(410).send({ ok: false, error: 'sgpdata_sync_import_deprecated', use: '/api/sgpdata/import/uploads' });
  });
}
