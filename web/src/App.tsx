import { useEffect, useMemo, useState } from "react";
import {
    Button,
    H1,
    H2,
    Paragraph,
    ScrollView,
    Text,
    XStack,
    YStack,
    Input,
    Theme,
} from "tamagui";

type FleetStatus = "" | "online" | "offline";

type FleetFilters = {
    site: string;
    zone: string;
    status: FleetStatus;
    search: string;
};

type FleetCohort = {
    cohortId: string;
    name: string;
    filters: FleetFilters;
    createdAt?: string;
    updatedAt?: string;
};

type DeviceMetadata = {
    name?: string;
    site?: string;
    zone?: string;
    firmwareVersion?: string;
    sensorVersion?: string;
    notes?: string;
};

type DeviceListItem = {
    deviceId: string;
    online: boolean;
    metadata?: DeviceMetadata;
    connectedAt?: string;
};

type BatchSummary = {
    total: number;
    dispatched: number;
    accepted: number;
    failed: number;
};

type RolloutStrategy = "all-at-once" | "wave" | "canary";
type RolloutStatus =
    | "draft"
    | "scheduled"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "rolled_back"
    | "canceled";

type RolloutPlan = {
    planId: string;
    name: string;
    status: RolloutStatus;
    strategy: RolloutStrategy;
    targetCount: number;
    cohortRef: string;
    createdAt?: string;
    updatedAt?: string;
};

type RolloutExecution = {
    executionId: string;
    status: RolloutStatus;
    currentWaveIndex: number;
    totalWaves: number;
    sentCount: number;
    ackedCount: number;
    timeoutCount: number;
    failedCount: number;
    startedAt?: string;
    completedAt?: string;
    failureReason?: string;
    rollbackReason?: string;
};

type RolloutWave = {
    waveId: string;
    index: number;
    label: string;
    status: string;
    targetCount: number;
    sentCount: number;
    ackedCount: number;
    timeoutCount: number;
    failedCount: number;
    gateDecision?: string;
    startedAt?: string;
    completedAt?: string;
};

type RolloutEvent = {
    eventId: string;
    type: string;
    actor: string;
    message: string;
    createdAt?: string;
};

type RolloutSummary = {
    medianWaveDurationMs: number;
    successRatio: number;
    timeoutRatio: number;
    failureRatio: number;
};

type GovernanceActionType = "fleet_batch_apply" | "rollout_start";
type GovernanceApprovalStatus =
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "used"
    | "canceled";

type GovernanceApproval = {
    approvalId: string;
    actionType: GovernanceActionType;
    status: GovernanceApprovalStatus;
    riskLevel: string;
    requestedBy: string;
    approverId?: string;
    targetCount: number;
    resourceId?: string;
    cohortRef?: string;
    requestNote?: string;
    approverNote?: string;
    rejectedNote?: string;
    expiresAt?: string;
    createdAt?: string;
    updatedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    usedAt?: string;
};

type GovernanceSummary = {
    pending: number;
    approved: number;
    rejected: number;
    used: number;
    expired: number;
    canceled: number;
};

type ApiResult<T> = {
    ok: boolean;
    status: number;
    payload: T | null;
};

function safeString(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value);
}

function normalizeStatus(value: string): FleetStatus {
    const lower = value.trim().toLowerCase();
    if (lower === "online" || lower === "offline") {
        return lower;
    }
    return "";
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function firstArray(...values: unknown[]): unknown[] {
    for (const value of values) {
        if (Array.isArray(value)) {
            return value;
        }
    }
    return [];
}

function parseFleetFilters(value: unknown): FleetFilters {
    const record = asRecord(value);
    return {
        site: safeString(record.site),
        zone: safeString(record.zone),
        status: normalizeStatus(safeString(record.status)),
        search: safeString(record.search),
    };
}

function parseCohortItem(value: unknown): FleetCohort | null {
    const record = asRecord(value);
    const cohortId = safeString(record.cohortId || record.id || record._id);
    const name = safeString(record.name);
    if (!cohortId || !name) {
        return null;
    }

    return {
        cohortId,
        name,
        filters: parseFleetFilters(record.filters),
        createdAt: safeString(record.createdAt) || undefined,
        updatedAt: safeString(record.updatedAt) || undefined,
    };
}

function parseCohorts(payload: unknown): FleetCohort[] {
    const root = asRecord(payload);
    const source = firstArray(root.data, root.items, root.cohorts, payload);

    return source
        .map(parseCohortItem)
        .filter((item): item is FleetCohort => Boolean(item));
}

function parseDevices(payload: unknown): DeviceListItem[] {
    const root = asRecord(payload);
    const source = firstArray(root.data, root.devices, root.items, payload);

    return source
        .map((item) => asRecord(item))
        .map((item) => ({
            deviceId: safeString(item.deviceId || item.id || item.device_id),
            online: Boolean(item.online),
            connectedAt:
                safeString(item.connectedAt || item.connected_at) || undefined,
            metadata: asRecord(item.metadata) as DeviceMetadata,
        }))
        .filter((item) => Boolean(item.deviceId));
}

function parseBatchSummary(payload: unknown): BatchSummary {
    const root = asRecord(payload);
    const data = asRecord(root.data || root.summary || payload);

    const total = Number(
        data.total ??
            data.matched ??
            data.count ??
            root.total ??
            root.matched ??
            root.count ??
            0,
    );
    const dispatched = Number(data.dispatched ?? root.dispatched ?? total);
    const accepted = Number(
        data.accepted ?? data.success ?? root.accepted ?? root.success ?? 0,
    );
    const failed = Number(
        data.failed ?? data.errors ?? root.failed ?? root.errors ?? 0,
    );

    return {
        total: Number.isFinite(total) ? total : 0,
        dispatched: Number.isFinite(dispatched) ? dispatched : 0,
        accepted: Number.isFinite(accepted) ? accepted : 0,
        failed: Number.isFinite(failed) ? failed : 0,
    };
}

function normalizeRolloutStrategy(value: string): RolloutStrategy {
    if (value === "all-at-once" || value === "wave" || value === "canary") {
        return value;
    }
    return "wave";
}

function parseRolloutPlan(value: unknown): RolloutPlan | null {
    const record = asRecord(value);
    const planId = safeString(record.planId || record.id);
    const name = safeString(record.name);
    const strategy = normalizeRolloutStrategy(safeString(record.strategy));
    const status = safeString(record.status) as RolloutStatus;
    if (!planId || !name || !status) {
        return null;
    }

    return {
        planId,
        name,
        status,
        strategy,
        targetCount: Number(record.targetCount || 0),
        cohortRef: safeString(record.cohortRef),
        createdAt: safeString(record.createdAt) || undefined,
        updatedAt: safeString(record.updatedAt) || undefined,
    };
}

function parseRolloutPlans(payload: unknown): RolloutPlan[] {
    const root = asRecord(payload);
    const source = firstArray(root.data, root.items, root.rollouts, payload);
    return source
        .map(parseRolloutPlan)
        .filter((item): item is RolloutPlan => Boolean(item));
}

function parseRolloutExecution(value: unknown): RolloutExecution | null {
    const record = asRecord(value);
    const executionId = safeString(record.executionId || record.id);
    const status = safeString(record.status) as RolloutStatus;
    if (!executionId || !status) {
        return null;
    }
    return {
        executionId,
        status,
        currentWaveIndex: Number(record.currentWaveIndex || 0),
        totalWaves: Number(record.totalWaves || 0),
        sentCount: Number(record.sentCount || 0),
        ackedCount: Number(record.ackedCount || 0),
        timeoutCount: Number(record.timeoutCount || 0),
        failedCount: Number(record.failedCount || 0),
        startedAt: safeString(record.startedAt) || undefined,
        completedAt: safeString(record.completedAt) || undefined,
        failureReason: safeString(record.failureReason) || undefined,
        rollbackReason: safeString(record.rollbackReason) || undefined,
    };
}

function parseRolloutWaves(payload: unknown): RolloutWave[] {
    const root = asRecord(payload);
    const source = firstArray(root.data, root.waves, payload);
    return source
        .map((item) => asRecord(item))
        .map((record) => ({
            waveId: safeString(record.waveId || record.id),
            index: Number(record.index || 0),
            label: safeString(
                record.label || `wave-${safeString(record.index)}`,
            ),
            status: safeString(record.status || "pending"),
            targetCount: Number(record.targetCount || 0),
            sentCount: Number(record.sentCount || 0),
            ackedCount: Number(record.ackedCount || 0),
            timeoutCount: Number(record.timeoutCount || 0),
            failedCount: Number(record.failedCount || 0),
            gateDecision: safeString(record.gateDecision) || undefined,
            startedAt: safeString(record.startedAt) || undefined,
            completedAt: safeString(record.completedAt) || undefined,
        }))
        .filter((wave) => Boolean(wave.waveId));
}

function parseRolloutEvents(payload: unknown): RolloutEvent[] {
    const root = asRecord(payload);
    const source = firstArray(root.data, root.events, payload);
    return source
        .map((item) => asRecord(item))
        .map((record) => ({
            eventId: safeString(record.eventId || record.id),
            type: safeString(record.type),
            actor: safeString(record.actor),
            message: safeString(record.message),
            createdAt: safeString(record.createdAt) || undefined,
        }))
        .filter((event) => Boolean(event.eventId));
}

function parseRolloutSummary(value: unknown): RolloutSummary | null {
    const record = asRecord(value);
    if (!Object.keys(record).length) {
        return null;
    }
    return {
        medianWaveDurationMs: Number(record.medianWaveDurationMs || 0),
        successRatio: Number(record.successRatio || 0),
        timeoutRatio: Number(record.timeoutRatio || 0),
        failureRatio: Number(record.failureRatio || 0),
    };
}

function normalizeGovernanceAction(value: string): GovernanceActionType {
    if (value === "fleet_batch_apply" || value === "rollout_start") {
        return value;
    }
    return "fleet_batch_apply";
}

function parseGovernanceApproval(payload: unknown): GovernanceApproval | null {
    const record = asRecord(payload);
    const target = asRecord(record.target);
    const approvalId = safeString(record.approvalId || record.id);
    const actionType = normalizeGovernanceAction(safeString(record.actionType));
    const status = safeString(record.status) as GovernanceApprovalStatus;
    if (!approvalId || !status) {
        return null;
    }
    return {
        approvalId,
        actionType,
        status,
        riskLevel: safeString(record.riskLevel) || "high",
        requestedBy: safeString(record.requestedBy),
        approverId: safeString(record.approverId) || undefined,
        targetCount: Number(target.targetCount || 0),
        resourceId: safeString(target.resourceId) || undefined,
        cohortRef: safeString(target.cohortRef) || undefined,
        requestNote: safeString(record.requestNote) || undefined,
        approverNote: safeString(record.approverNote) || undefined,
        rejectedNote: safeString(record.rejectedNote) || undefined,
        expiresAt: safeString(record.expiresAt) || undefined,
        createdAt: safeString(record.createdAt) || undefined,
        updatedAt: safeString(record.updatedAt) || undefined,
        approvedAt: safeString(record.approvedAt) || undefined,
        rejectedAt: safeString(record.rejectedAt) || undefined,
        usedAt: safeString(record.usedAt) || undefined,
    };
}

function parseGovernanceApprovals(payload: unknown): GovernanceApproval[] {
    const root = asRecord(payload);
    const source = firstArray(root.data, root.items, payload);
    return source
        .map(parseGovernanceApproval)
        .filter((item): item is GovernanceApproval => Boolean(item));
}

function parseGovernanceSummary(payload: unknown): GovernanceSummary {
    const data = asRecord(asRecord(payload).data || payload);
    return {
        pending: Number(data.pending || 0),
        approved: Number(data.approved || 0),
        rejected: Number(data.rejected || 0),
        used: Number(data.used || 0),
        expired: Number(data.expired || 0),
        canceled: Number(data.canceled || 0),
    };
}

function parseTextMessage(payload: unknown, fallback: string): string {
    const root = asRecord(payload);
    return safeString(root.message || root.error || root.detail || fallback);
}

function buildFiltersQuery(filters: FleetFilters): string {
    const params = new URLSearchParams();
    if (filters.site.trim()) {
        params.set("site", filters.site.trim());
    }
    if (filters.zone.trim()) {
        params.set("zone", filters.zone.trim());
    }
    if (filters.status) {
        params.set("status", filters.status);
    }
    if (filters.search.trim()) {
        params.set("search", filters.search.trim());
    }
    const query = params.toString();
    return query ? `?${query}` : "";
}

export default function App() {
    const [cohortName, setCohortName] = useState("");
    const [selectedCohortId, setSelectedCohortId] = useState("");
    const [filters, setFilters] = useState<FleetFilters>({
        site: "",
        zone: "",
        status: "",
        search: "",
    });

    const [configText, setConfigText] = useState('{"sampleRate":100}');
    const [batchNote, setBatchNote] = useState("");
    const [cohorts, setCohorts] = useState<FleetCohort[]>([]);
    const [previewDevices, setPreviewDevices] = useState<DeviceListItem[]>([]);
    const [inventoryDevices, setInventoryDevices] = useState<DeviceListItem[]>(
        [],
    );
    const [status, setStatus] = useState("Fleet console ready");
    const [loadingInventory, setLoadingInventory] = useState(false);
    const [loadingCohorts, setLoadingCohorts] = useState(false);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [savingCohort, setSavingCohort] = useState(false);
    const [deletingCohort, setDeletingCohort] = useState(false);
    const [batching, setBatching] = useState(false);
    const [batchSummary, setBatchSummary] = useState<BatchSummary>({
        total: 0,
        dispatched: 0,
        accepted: 0,
        failed: 0,
    });
    const [rolloutName, setRolloutName] = useState("");
    const [rolloutStrategy, setRolloutStrategy] =
        useState<RolloutStrategy>("wave");
    const [rolloutWaveSize, setRolloutWaveSize] = useState("100");
    const [rolloutCanarySize, setRolloutCanarySize] = useState("50");
    const [rolloutIntervalMs, setRolloutIntervalMs] = useState("2000");
    const [rolloutMaxFailureRatio, setRolloutMaxFailureRatio] = useState("0.1");
    const [rolloutMaxTimeoutRatio, setRolloutMaxTimeoutRatio] = useState("0.1");
    const [rolloutMinSuccessRatio, setRolloutMinSuccessRatio] = useState("0.8");
    const [rolloutNote, setRolloutNote] = useState("");
    const [rollouts, setRollouts] = useState<RolloutPlan[]>([]);
    const [selectedRolloutId, setSelectedRolloutId] = useState("");
    const [rolloutExecution, setRolloutExecution] =
        useState<RolloutExecution | null>(null);
    const [rolloutSummary, setRolloutSummary] = useState<RolloutSummary | null>(
        null,
    );
    const [rolloutWaves, setRolloutWaves] = useState<RolloutWave[]>([]);
    const [rolloutEvents, setRolloutEvents] = useState<RolloutEvent[]>([]);
    const [loadingRollouts, setLoadingRollouts] = useState(false);
    const [rolloutBusy, setRolloutBusy] = useState(false);
    const [selectedApprovalId, setSelectedApprovalId] = useState("");
    const [approvalActionType, setApprovalActionType] =
        useState<GovernanceActionType>("rollout_start");
    const [approvalRiskLevel, setApprovalRiskLevel] = useState("high");
    const [approvalResourceId, setApprovalResourceId] = useState("");
    const [approvalTargetCount, setApprovalTargetCount] = useState("0");
    const [approvalNote, setApprovalNote] = useState("");
    const [approvalRationale, setApprovalRationale] = useState("");
    const [approvalExpiresMinutes, setApprovalExpiresMinutes] = useState("60");
    const [approvalDecisionNote, setApprovalDecisionNote] = useState("");
    const [emergencyOverride, setEmergencyOverride] = useState(false);
    const [approvals, setApprovals] = useState<GovernanceApproval[]>([]);
    const [governanceSummary, setGovernanceSummary] =
        useState<GovernanceSummary>({
            pending: 0,
            approved: 0,
            rejected: 0,
            used: 0,
            expired: 0,
            canceled: 0,
        });
    const [loadingApprovals, setLoadingApprovals] = useState(false);
    const [approvalBusy, setApprovalBusy] = useState(false);
    const selectedRolloutPlan = useMemo(
        () =>
            rollouts.find((item) => item.planId === selectedRolloutId) ?? null,
        [rollouts, selectedRolloutId],
    );

    async function requestJson<T>(
        url: string,
        init?: RequestInit,
    ): Promise<ApiResult<T>> {
        try {
            const headers = new Headers({
                Accept: "application/json",
            });
            if (init?.headers) {
                new Headers(init.headers).forEach((value, key) => {
                    headers.set(key, value);
                });
            }
            if (init?.body && !headers.has("Content-Type")) {
                headers.set("Content-Type", "application/json");
            }

            const response = await fetch(url, {
                ...init,
                headers,
            });

            const text = await response.text();
            let payload: unknown = null;
            if (text) {
                try {
                    payload = JSON.parse(text);
                } catch {
                    payload = text;
                }
            }

            return {
                ok: response.ok,
                status: response.status,
                payload: payload as T | null,
            };
        } catch (error) {
            return {
                ok: false,
                status: 0,
                payload: { error: safeString(error) } as T,
            };
        }
    }

    async function loadCohorts(
        selectId?: string,
    ): Promise<FleetCohort[] | null> {
        setLoadingCohorts(true);
        const result = await requestJson<unknown>("/api/fleet/cohorts");
        setLoadingCohorts(false);

        if (!result.ok || !result.payload) {
            setCohorts([]);
            setStatus("Failed to load cohorts");
            return null;
        }

        const parsed = parseCohorts(result.payload);
        setCohorts(parsed);

        const nextSelectedId = selectId || selectedCohortId;
        if (nextSelectedId) {
            const selected = parsed.find(
                (item) => item.cohortId === nextSelectedId,
            );
            if (selected) {
                setCohortName(selected.name);
                setFilters(selected.filters);
                setSelectedCohortId(selected.cohortId);
            } else if (selectedCohortId === nextSelectedId) {
                setSelectedCohortId("");
            }
        }

        setStatus(`Loaded ${parsed.length} cohorts`);
        return parsed;
    }

    async function loadDeviceInventory(): Promise<DeviceListItem[] | null> {
        setLoadingInventory(true);
        const result = await requestJson<unknown>("/api/devices?limit=500");
        setLoadingInventory(false);

        if (!result.ok || !result.payload) {
            setInventoryDevices([]);
            setStatus("Failed to load device inventory");
            return null;
        }

        const parsed = parseDevices(result.payload).sort((left, right) => {
            if (left.online !== right.online) {
                return left.online ? -1 : 1;
            }
            return left.deviceId.localeCompare(right.deviceId);
        });
        setInventoryDevices(parsed);
        return parsed;
    }

    async function previewCohort(): Promise<DeviceListItem[] | null> {
        setLoadingPreview(true);
        setStatus("Loading cohort preview...");

        const result = await requestJson<unknown>(
            "/api/fleet/cohorts/preview",
            {
                method: "POST",
                body: JSON.stringify({ filters }),
            },
        );
        setLoadingPreview(false);

        if (!result.ok || !result.payload) {
            setPreviewDevices([]);
            setStatus("Failed to load cohort preview");
            return null;
        }

        const parsed = parseDevices(result.payload);
        setPreviewDevices(parsed);
        setApprovalActionType("fleet_batch_apply");
        setApprovalResourceId("");
        setApprovalTargetCount(String(parsed.length));
        setStatus(`Preview matched ${parsed.length} devices`);
        return parsed;
    }

    function parseConfigPayload(): Record<string, unknown> | null {
        const raw = configText.trim();
        if (!raw) {
            setStatus("Config JSON is required");
            return null;
        }

        try {
            const parsed = JSON.parse(raw);
            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                setStatus("Config payload must be a JSON object");
                return null;
            }
            return parsed as Record<string, unknown>;
        } catch {
            setStatus("Config JSON invalid");
            return null;
        }
    }

    async function createCohort() {
        const name = cohortName.trim();
        if (!name) {
            setStatus("Cohort name is required");
            return;
        }

        setSavingCohort(true);
        const result = await requestJson<unknown>("/api/fleet/cohorts", {
            method: "POST",
            body: JSON.stringify({
                name,
                filters,
            }),
        });
        setSavingCohort(false);

        if (!result.ok) {
            setStatus(`Failed to create cohort (HTTP ${result.status})`);
            return;
        }

        setStatus(`Created cohort ${name}`);
        await loadCohorts();
    }

    async function updateCohort() {
        if (!selectedCohortId) {
            setStatus("Select a cohort to update");
            return;
        }

        const name = cohortName.trim();
        if (!name) {
            setStatus("Cohort name is required");
            return;
        }

        setSavingCohort(true);
        const result = await requestJson<unknown>(
            `/api/fleet/cohorts/${encodeURIComponent(selectedCohortId)}`,
            {
                method: "PUT",
                body: JSON.stringify({
                    name,
                    filters,
                }),
            },
        );
        setSavingCohort(false);

        if (!result.ok) {
            setStatus(`Failed to update cohort (HTTP ${result.status})`);
            return;
        }

        setStatus(`Updated cohort ${name}`);
        await loadCohorts(selectedCohortId);
    }

    async function deleteCohort() {
        if (!selectedCohortId) {
            setStatus("Select a cohort to delete");
            return;
        }

        const selected = cohorts.find(
            (item) => item.cohortId === selectedCohortId,
        );
        setDeletingCohort(true);
        const result = await requestJson<unknown>(
            `/api/fleet/cohorts/${encodeURIComponent(selectedCohortId)}`,
            {
                method: "DELETE",
            },
        );
        setDeletingCohort(false);

        if (!result.ok) {
            setStatus(`Failed to delete cohort (HTTP ${result.status})`);
            return;
        }

        setSelectedCohortId("");
        setStatus(`Deleted cohort ${selected?.name || selectedCohortId}`);
        await loadCohorts();
    }

    function parsePositiveInt(input: string, fallback: number): number {
        const parsed = Number(input);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }
        return Math.floor(parsed);
    }

    function parseRatio(input: string, fallback: number): number {
        const parsed = Number(input);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        if (parsed < 0) {
            return 0;
        }
        if (parsed > 1) {
            return 1;
        }
        return parsed;
    }

    function formatPercent(value: number): string {
        if (!Number.isFinite(value)) {
            return "0%";
        }
        return `${(value * 100).toFixed(1)}%`;
    }

    function formatTimestamp(value?: string): string {
        if (!value) {
            return "-";
        }
        const time = Date.parse(value);
        if (!Number.isFinite(time)) {
            return value;
        }
        return new Date(time).toLocaleString();
    }

    async function loadRollouts(
        selectPlanId?: string,
    ): Promise<RolloutPlan[] | null> {
        setLoadingRollouts(true);
        const result = await requestJson<unknown>("/api/rollouts?limit=50");
        setLoadingRollouts(false);

        if (!result.ok || !result.payload) {
            setRollouts([]);
            setStatus("Failed to load rollouts");
            return null;
        }

        const parsed = parseRolloutPlans(result.payload);
        setRollouts(parsed);
        const nextPlanId = selectPlanId || selectedRolloutId;
        if (nextPlanId) {
            const found = parsed.find((plan) => plan.planId === nextPlanId);
            if (found) {
                setSelectedRolloutId(nextPlanId);
                await loadRolloutDetails(nextPlanId);
            } else {
                setSelectedRolloutId("");
                setRolloutExecution(null);
                setRolloutSummary(null);
                setRolloutWaves([]);
                setRolloutEvents([]);
            }
        }
        return parsed;
    }

    async function loadRolloutDetails(planId: string): Promise<void> {
        const [detailResult, wavesResult, eventsResult] = await Promise.all([
            requestJson<unknown>(`/api/rollouts/${encodeURIComponent(planId)}`),
            requestJson<unknown>(
                `/api/rollouts/${encodeURIComponent(planId)}/waves`,
            ),
            requestJson<unknown>(
                `/api/rollouts/${encodeURIComponent(planId)}/events?limit=60`,
            ),
        ]);

        if (detailResult.ok && detailResult.payload) {
            const root = asRecord(detailResult.payload);
            const data = asRecord(root.data);
            setRolloutExecution(parseRolloutExecution(data.execution));
            setRolloutSummary(parseRolloutSummary(data.summary));
        }

        if (wavesResult.ok && wavesResult.payload) {
            setRolloutWaves(parseRolloutWaves(wavesResult.payload));
        } else {
            setRolloutWaves([]);
        }

        if (eventsResult.ok && eventsResult.payload) {
            setRolloutEvents(parseRolloutEvents(eventsResult.payload));
        } else {
            setRolloutEvents([]);
        }
    }

    async function createRolloutPlan(): Promise<void> {
        const payload = parseConfigPayload();
        if (!payload) {
            return;
        }

        const body: Record<string, unknown> = {
            name: rolloutName.trim() || `rollout-${Date.now()}`,
            strategy: rolloutStrategy,
            payload,
            waveSize: parsePositiveInt(rolloutWaveSize, 100),
            waveIntervalMs: parsePositiveInt(rolloutIntervalMs, 2_000),
            autoRollback: true,
            gate: {
                maxFailureRatio: parseRatio(rolloutMaxFailureRatio, 0.1),
                maxTimeoutRatio: parseRatio(rolloutMaxTimeoutRatio, 0.1),
                minSuccessRatio: parseRatio(rolloutMinSuccessRatio, 0.8),
            },
        };

        if (rolloutStrategy === "canary") {
            body.canarySize = parsePositiveInt(rolloutCanarySize, 50);
        }
        if (selectedCohortId) {
            body.cohortId = selectedCohortId;
        } else {
            body.filters = filters;
        }

        setRolloutBusy(true);
        const result = await requestJson<unknown>("/api/rollouts", {
            method: "POST",
            body: JSON.stringify(body),
        });
        setRolloutBusy(false);

        if (!result.ok || !result.payload) {
            setStatus(`Failed to create rollout (HTTP ${result.status})`);
            return;
        }

        const data = asRecord(asRecord(result.payload).data);
        const plan = parseRolloutPlan(data.plan);
        if (plan) {
            setSelectedRolloutId(plan.planId);
            await loadRollouts(plan.planId);
            setStatus(`Created rollout ${plan.name}`);
            return;
        }
        await loadRollouts();
        setStatus("Created rollout");
    }

    async function rolloutAction(
        path: string,
        requireNote: boolean,
    ): Promise<void> {
        if (!selectedRolloutId) {
            setStatus("Select a rollout plan first");
            return;
        }
        const note = rolloutNote.trim();
        if (requireNote && !note) {
            setStatus("Rollout note is required for this action");
            return;
        }

        const body: Record<string, unknown> = {};
        if (note) {
            body.note = note;
        }
        if (path === "start") {
            if (selectedApprovalId.trim()) {
                body.approvalId = selectedApprovalId.trim();
            }
            if (emergencyOverride) {
                body.emergencyOverride = true;
            }
        }

        setRolloutBusy(true);
        const result = await requestJson<unknown>(
            `/api/rollouts/${encodeURIComponent(selectedRolloutId)}/${path}`,
            {
                method: "POST",
                body: JSON.stringify(body),
            },
        );
        setRolloutBusy(false);

        if (!result.ok) {
            setStatus(`Rollout action failed (HTTP ${result.status})`);
            return;
        }

        await loadRollouts(selectedRolloutId);
        setStatus(`Rollout action "${path}" executed`);
    }

    async function processRolloutTick(): Promise<void> {
        setRolloutBusy(true);
        const result = await requestJson<unknown>("/api/rollouts/process", {
            method: "POST",
            body: JSON.stringify({}),
        });
        setRolloutBusy(false);
        if (!result.ok) {
            setStatus(`Rollout process tick failed (HTTP ${result.status})`);
            return;
        }
        if (selectedRolloutId) {
            await loadRolloutDetails(selectedRolloutId);
        }
        await loadRollouts(selectedRolloutId || undefined);
        setStatus("Rollout process tick completed");
    }

    async function loadApprovals(selectApprovalId?: string): Promise<void> {
        setLoadingApprovals(true);
        const [listResult, summaryResult] = await Promise.all([
            requestJson<unknown>("/api/governance/approvals?limit=80"),
            requestJson<unknown>("/api/governance/summary"),
        ]);
        setLoadingApprovals(false);

        if (listResult.ok && listResult.payload) {
            const parsed = parseGovernanceApprovals(listResult.payload);
            setApprovals(parsed);
            const preferred = selectApprovalId || selectedApprovalId;
            if (
                preferred &&
                parsed.some((item) => item.approvalId === preferred)
            ) {
                setSelectedApprovalId(preferred);
            }
        } else {
            setApprovals([]);
        }

        if (summaryResult.ok && summaryResult.payload) {
            setGovernanceSummary(parseGovernanceSummary(summaryResult.payload));
        }
    }

    async function createApprovalRequest(): Promise<void> {
        const targetCount = parsePositiveInt(approvalTargetCount, 0);
        if (targetCount <= 0) {
            setStatus("Approval target count must be > 0");
            return;
        }

        const resourceId =
            approvalResourceId.trim() ||
            (approvalActionType === "rollout_start" ? selectedRolloutId : "");
        const body = {
            actionType: approvalActionType,
            riskLevel: approvalRiskLevel || "high",
            requestNote: approvalNote.trim() || undefined,
            rationale: approvalRationale.trim() || undefined,
            expiresInMinutes: parsePositiveInt(approvalExpiresMinutes, 60),
            target: {
                resourceType:
                    approvalActionType === "rollout_start"
                        ? "rollout_plan"
                        : "fleet_batch",
                resourceId: resourceId || undefined,
                cohortRef: selectedCohortId || undefined,
                site: filters.site.trim() || undefined,
                zone: filters.zone.trim() || undefined,
                strategy:
                    approvalActionType === "rollout_start"
                        ? rolloutStrategy
                        : undefined,
                targetCount,
            },
        };

        setApprovalBusy(true);
        const result = await requestJson<unknown>("/api/governance/approvals", {
            method: "POST",
            body: JSON.stringify(body),
        });
        setApprovalBusy(false);

        if (!result.ok || !result.payload) {
            setStatus(`Create approval failed (HTTP ${result.status})`);
            return;
        }

        const approval = parseGovernanceApproval(asRecord(result.payload).data);
        if (approval) {
            setSelectedApprovalId(approval.approvalId);
            await loadApprovals(approval.approvalId);
            setStatus(`Approval request created: ${approval.approvalId}`);
            return;
        }
        await loadApprovals();
        setStatus("Approval request created");
    }

    async function decideApproval(
        approvalId: string,
        decision: "approve" | "reject",
    ): Promise<void> {
        setApprovalBusy(true);
        const result = await requestJson<unknown>(
            `/api/governance/approvals/${encodeURIComponent(approvalId)}/${decision}`,
            {
                method: "POST",
                body: JSON.stringify({
                    note: approvalDecisionNote.trim() || undefined,
                }),
            },
        );
        setApprovalBusy(false);
        if (!result.ok) {
            setStatus(`Approval ${decision} failed (HTTP ${result.status})`);
            return;
        }

        await loadApprovals(approvalId);
        setStatus(`Approval ${decision}d: ${approvalId}`);
    }

    async function dryRunBatch() {
        const config = parseConfigPayload();
        if (!config) {
            return;
        }

        setBatching(true);
        setStatus("Running dry-run...");

        const result = await requestJson<unknown>(
            "/api/fleet/batches/dry-run",
            {
                method: "POST",
                body: JSON.stringify({
                    filters,
                    payload: config,
                    note: batchNote.trim() || undefined,
                }),
            },
        );
        setBatching(false);

        if (!result.ok || !result.payload) {
            setStatus("Dry-run failed");
            return;
        }

        const summary = parseBatchSummary(result.payload);
        setBatchSummary(summary);
        setStatus(
            `Dry-run done: total=${summary.total}, dispatched=${summary.dispatched}, accepted=${summary.accepted}, failed=${summary.failed}`,
        );
    }

    async function applyBatch() {
        const config = parseConfigPayload();
        if (!config) {
            return;
        }

        const note = batchNote.trim();
        if (!note) {
            setStatus("Operator note is required before apply");
            return;
        }

        setBatching(true);
        setStatus("Applying batch...");

        const result = await requestJson<unknown>("/api/fleet/batches/apply", {
            method: "POST",
            body: JSON.stringify({
                filters,
                payload: config,
                note,
                approvalId: selectedApprovalId.trim() || undefined,
                emergencyOverride: emergencyOverride || undefined,
            }),
        });
        setBatching(false);

        if (!result.ok || !result.payload) {
            setStatus("Batch apply failed");
            return;
        }

        const summary = parseBatchSummary(result.payload);
        setBatchSummary(summary);
        setStatus(
            `Batch done: total=${summary.total}, dispatched=${summary.dispatched}, accepted=${summary.accepted}, failed=${summary.failed}`,
        );
    }

    useEffect(() => {
        void loadCohorts();
        void loadDeviceInventory();
        void loadRollouts();
        void loadApprovals();
        const refreshInventory = window.setInterval(() => {
            void loadDeviceInventory();
        }, 5000);

        return () => {
            window.clearInterval(refreshInventory);
        };
    }, []);

    return (
        <Theme name="dark">
            <YStack
                minHeight="100vh"
                backgroundColor="$background"
                padding="$4"
                gap="$4"
            >
                <YStack
                    borderWidth={1}
                    borderColor="$borderColor"
                    borderRadius="$8"
                    padding="$6"
                    backgroundColor="$color3"
                    gap="$3"
                    justifyContent="center"
                    alignItems="center"
                >
                    {/* Tiêu đề chính */}
                    <H1
                        size="$10"
                        color="$primary"
                        textAlign="center"
                        fontWeight="800"
                        letterSpacing="0.5px"
                    >
                        SGP Vibration Datacenter
                    </H1>

                    {/* Mô tả */}
                    <Paragraph
                        color="$gray12"
                        textAlign="center"
                        fontSize={18}
                        lineHeight={1.5}
                    >
                        Giao diện quản lý cảm biến rung: giám sát, phân tích và
                        điều khiển cảm biến của hệ thống.
                    </Paragraph>

                    {/* Chế độ truy cập */}
                    <Text
                        color="$gray10"
                        textAlign="center"
                        fontSize={14}
                        fontStyle="italic"
                    >
                        Chế độ truy cập mở
                    </Text>
                </YStack>

                <YStack
                    borderWidth={1}
                    borderColor="$borderColor"
                    borderRadius="$6"
                    padding="$4"
                    backgroundColor="$color1"
                    gap="$3"
                >
                    <XStack
                        justifyContent="space-between"
                        alignItems="center"
                        flexWrap="wrap"
                        gap="$2"
                    >
                        <H2 size="$6">Device Inventory</H2>
                        <Text color="$gray10">
                            {loadingInventory
                                ? "Refreshing inventory..."
                                : `${inventoryDevices.length} devices`}
                        </Text>
                    </XStack>

                    <XStack gap="$3" flexWrap="wrap">
                        <Text color="$green10">
                            Online:{" "}
                            {
                                inventoryDevices.filter(
                                    (device) => device.online,
                                ).length
                            }
                        </Text>
                        <Text color="$red10">
                            Offline:{" "}
                            {
                                inventoryDevices.filter(
                                    (device) => !device.online,
                                ).length
                            }
                        </Text>
                    </XStack>

                    <ScrollView maxHeight={320}>
                        <YStack gap="$2">
                            {inventoryDevices.length === 0 ? (
                                <Paragraph color="$gray10">
                                    No devices reported yet. Start the simulator
                                    to populate the list.
                                </Paragraph>
                            ) : (
                                inventoryDevices.map((device) => (
                                    <YStack
                                        key={device.deviceId}
                                        borderWidth={1}
                                        borderColor="$borderColor"
                                        borderRadius="$4"
                                        padding="$3"
                                        gap="$1"
                                    >
                                        <XStack
                                            justifyContent="space-between"
                                            alignItems="center"
                                            flexWrap="wrap"
                                            gap="$2"
                                        >
                                            <Text fontWeight="700">
                                                {device.deviceId}
                                            </Text>
                                            <Text
                                                color={
                                                    device.online
                                                        ? "$green10"
                                                        : "$red10"
                                                }
                                            >
                                                {device.online
                                                    ? "online"
                                                    : "offline"}
                                            </Text>
                                        </XStack>
                                        <Text color="$gray10">
                                            {device.metadata?.name || "-"} ·
                                            site {device.metadata?.site || "-"}{" "}
                                            · zone{" "}
                                            {device.metadata?.zone || "-"}
                                        </Text>
                                        <Text color="$gray10">
                                            fw{" "}
                                            {device.metadata?.firmwareVersion ||
                                                "-"}{" "}
                                            · sensor{" "}
                                            {device.metadata?.sensorVersion ||
                                                "-"}
                                        </Text>
                                        <Text color="$gray10">
                                            connected{" "}
                                            {formatTimestamp(
                                                device.connectedAt,
                                            )}
                                        </Text>
                                    </YStack>
                                ))
                            )}
                        </YStack>
                    </ScrollView>
                </YStack>

                <YStack
                    borderWidth={1}
                    borderColor="$borderColor"
                    borderRadius="$6"
                    padding="$4"
                    backgroundColor="$color1"
                    gap="$3"
                >
                    <XStack
                        justifyContent="space-between"
                        alignItems="center"
                        flexWrap="wrap"
                        gap="$2"
                    >
                        <H2 size="$6">Governance Inbox</H2>
                        <Text color="$gray10">
                            {loadingApprovals
                                ? "Loading approvals..."
                                : `${approvals.length} approvals`}
                        </Text>
                    </XStack>

                    <XStack gap="$3" flexWrap="wrap">
                        <Text>Pending: {governanceSummary.pending}</Text>
                        <Text color="$green10">
                            Approved: {governanceSummary.approved}
                        </Text>
                        <Text color="$red10">
                            Rejected: {governanceSummary.rejected}
                        </Text>
                        <Text color="$blue10">
                            Used: {governanceSummary.used}
                        </Text>
                        <Text color="$gray10">
                            Expired: {governanceSummary.expired}
                        </Text>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap" alignItems="center">
                        <select
                            value={selectedApprovalId}
                            onChange={(event) =>
                                setSelectedApprovalId(event.target.value)
                            }
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                                minWidth: 260,
                            }}
                        >
                            <option value="">
                                Select approval (optional)...
                            </option>
                            {approvals.map((item) => (
                                <option
                                    key={item.approvalId}
                                    value={item.approvalId}
                                >
                                    {item.approvalId} · {item.actionType} ·{" "}
                                    {item.status}
                                </option>
                            ))}
                        </select>
                        <select
                            value={emergencyOverride ? "yes" : "no"}
                            onChange={(event) =>
                                setEmergencyOverride(
                                    event.target.value === "yes",
                                )
                            }
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                            }}
                        >
                            <option value="no">No emergency override</option>
                            <option value="yes">Emergency override</option>
                        </select>
                        <Button
                            size="$3"
                            onPress={() =>
                                void loadApprovals(
                                    selectedApprovalId || undefined,
                                )
                            }
                            disabled={loadingApprovals}
                        >
                            Refresh inbox
                        </Button>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap">
                        <select
                            value={approvalActionType}
                            onChange={(event) =>
                                setApprovalActionType(
                                    normalizeGovernanceAction(
                                        event.target.value,
                                    ),
                                )
                            }
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                            }}
                        >
                            <option value="rollout_start">rollout_start</option>
                            <option value="fleet_batch_apply">
                                fleet_batch_apply
                            </option>
                        </select>
                        <Input
                            width={140}
                            value={approvalRiskLevel}
                            onChangeText={setApprovalRiskLevel}
                            placeholder="risk level"
                        />
                        <Input
                            width={180}
                            value={approvalResourceId}
                            onChangeText={setApprovalResourceId}
                            placeholder="resourceId (planId)"
                        />
                        <Input
                            width={140}
                            value={approvalTargetCount}
                            onChangeText={setApprovalTargetCount}
                            placeholder="target count"
                            keyboardType="numeric"
                        />
                        <Input
                            width={120}
                            value={approvalExpiresMinutes}
                            onChangeText={setApprovalExpiresMinutes}
                            placeholder="expires min"
                            keyboardType="numeric"
                        />
                    </XStack>

                    <Input
                        value={approvalNote}
                        onChangeText={setApprovalNote}
                        placeholder="request note"
                    />
                    <Input
                        value={approvalRationale}
                        onChangeText={setApprovalRationale}
                        placeholder="rationale"
                    />
                    <XStack gap="$2" flexWrap="wrap">
                        <Button
                            size="$3"
                            theme="blue"
                            onPress={() => void createApprovalRequest()}
                            disabled={approvalBusy}
                        >
                            Request Approval
                        </Button>
                        <Input
                            flex={1}
                            minWidth={220}
                            value={approvalDecisionNote}
                            onChangeText={setApprovalDecisionNote}
                            placeholder="decision note (approve/reject)"
                        />
                    </XStack>

                    <ScrollView maxHeight={280}>
                        <YStack gap="$2">
                            {approvals.length === 0 ? (
                                <Paragraph color="$gray10">
                                    No approval requests yet.
                                </Paragraph>
                            ) : (
                                approvals.map((approval) => (
                                    <YStack
                                        key={approval.approvalId}
                                        borderWidth={1}
                                        borderColor="$borderColor"
                                        borderRadius="$4"
                                        padding="$3"
                                        gap="$1"
                                    >
                                        <XStack
                                            justifyContent="space-between"
                                            alignItems="center"
                                            flexWrap="wrap"
                                            gap="$2"
                                        >
                                            <Text fontWeight="700">
                                                {approval.approvalId}
                                            </Text>
                                            <Text
                                                color={
                                                    approval.status ===
                                                        "approved" ||
                                                    approval.status === "used"
                                                        ? "$green10"
                                                        : approval.status ===
                                                            "pending"
                                                          ? "$yellow10"
                                                          : approval.status ===
                                                              "rejected"
                                                            ? "$red10"
                                                            : "$gray10"
                                                }
                                            >
                                                {approval.status}
                                            </Text>
                                        </XStack>
                                        <Text color="$gray10">
                                            {approval.actionType} · target{" "}
                                            {approval.targetCount} · requester{" "}
                                            {approval.requestedBy}
                                        </Text>
                                        <Text color="$gray10">
                                            approver{" "}
                                            {approval.approverId || "-"} ·
                                            expires{" "}
                                            {formatTimestamp(
                                                approval.expiresAt,
                                            )}
                                        </Text>
                                        <Text color="$gray10">
                                            created{" "}
                                            {formatTimestamp(
                                                approval.createdAt,
                                            )}{" "}
                                            · updated{" "}
                                            {formatTimestamp(
                                                approval.updatedAt,
                                            )}
                                        </Text>
                                        <Text color="$gray10">
                                            note {approval.requestNote || "-"} ·
                                            decision{" "}
                                            {approval.approverNote ||
                                                approval.rejectedNote ||
                                                "-"}
                                        </Text>
                                        <XStack gap="$2" flexWrap="wrap">
                                            <Button
                                                size="$2"
                                                onPress={() =>
                                                    void decideApproval(
                                                        approval.approvalId,
                                                        "approve",
                                                    )
                                                }
                                                disabled={
                                                    approvalBusy ||
                                                    approval.status !==
                                                        "pending"
                                                }
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                size="$2"
                                                theme="red"
                                                onPress={() =>
                                                    void decideApproval(
                                                        approval.approvalId,
                                                        "reject",
                                                    )
                                                }
                                                disabled={
                                                    approvalBusy ||
                                                    approval.status !==
                                                        "pending"
                                                }
                                            >
                                                Reject
                                            </Button>
                                        </XStack>
                                    </YStack>
                                ))
                            )}
                        </YStack>
                    </ScrollView>
                </YStack>

                <YStack
                    borderWidth={1}
                    borderColor="$borderColor"
                    borderRadius="$6"
                    padding="$4"
                    backgroundColor="$color1"
                    gap="$3"
                >
                    <H2 size="$6">Control Panel</H2>
                    <Paragraph color="$gray10">
                        Cohort management and batch controls are open to all
                        users.
                    </Paragraph>

                    <XStack gap="$2" flexWrap="wrap">
                        <Input
                            flex={1}
                            minWidth={180}
                            value={cohortName}
                            onChangeText={setCohortName}
                            placeholder="Cohort name"
                        />
                        <Button
                            size="$3"
                            onPress={() => void createCohort()}
                            disabled={savingCohort}
                        >
                            Save New
                        </Button>
                        <Button
                            size="$3"
                            onPress={() => void updateCohort()}
                            disabled={savingCohort || !selectedCohortId}
                        >
                            Update
                        </Button>
                        <Button
                            size="$3"
                            theme="red"
                            onPress={() => void deleteCohort()}
                            disabled={deletingCohort || !selectedCohortId}
                        >
                            Delete
                        </Button>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap">
                        <select
                            value={selectedCohortId}
                            onChange={(event) => {
                                const cohortId = event.target.value;
                                setSelectedCohortId(cohortId);
                                const selected = cohorts.find(
                                    (item) => item.cohortId === cohortId,
                                );
                                if (selected) {
                                    setCohortName(selected.name);
                                    setFilters(selected.filters);
                                    setStatus(`Loaded cohort ${selected.name}`);
                                }
                                if (!cohortId) {
                                    setStatus("Cohort selection cleared");
                                }
                            }}
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                                minWidth: 240,
                            }}
                        >
                            <option value="">Select cohort...</option>
                            {cohorts.map((item) => (
                                <option
                                    key={item.cohortId}
                                    value={item.cohortId}
                                >
                                    {item.name}
                                </option>
                            ))}
                        </select>
                        <Text color="$gray10">
                            {loadingCohorts
                                ? "Loading cohorts..."
                                : `${cohorts.length} cohorts`}
                        </Text>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap">
                        <Input
                            flex={1}
                            minWidth={120}
                            value={filters.site}
                            onChangeText={(value) =>
                                setFilters((current) => ({
                                    ...current,
                                    site: value,
                                }))
                            }
                            placeholder="site"
                        />
                        <Input
                            flex={1}
                            minWidth={120}
                            value={filters.zone}
                            onChangeText={(value) =>
                                setFilters((current) => ({
                                    ...current,
                                    zone: value,
                                }))
                            }
                            placeholder="zone"
                        />
                        <select
                            value={filters.status}
                            onChange={(event) =>
                                setFilters((current) => ({
                                    ...current,
                                    status: normalizeStatus(event.target.value),
                                }))
                            }
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                            }}
                        >
                            <option value="">all status</option>
                            <option value="online">online</option>
                            <option value="offline">offline</option>
                        </select>
                        <Input
                            flex={1}
                            minWidth={180}
                            value={filters.search}
                            onChangeText={(value) =>
                                setFilters((current) => ({
                                    ...current,
                                    search: value,
                                }))
                            }
                            placeholder="search"
                        />
                    </XStack>

                    <Input
                        value={configText}
                        onChangeText={setConfigText}
                        placeholder='{"sampleRate":100,"fftWindow":512}'
                    />
                    <Input
                        value={batchNote}
                        onChangeText={setBatchNote}
                        placeholder="Operator note (required for apply)"
                    />

                    <XStack gap="$2" flexWrap="wrap">
                        <Button
                            size="$3"
                            theme="blue"
                            onPress={() => void previewCohort()}
                            disabled={loadingPreview}
                        >
                            Preview
                        </Button>
                        <Button
                            size="$3"
                            theme="orange"
                            onPress={() => void dryRunBatch()}
                            disabled={batching}
                        >
                            Dry-Run
                        </Button>
                        <Button
                            size="$3"
                            theme="green"
                            onPress={() => void applyBatch()}
                            disabled={batching}
                        >
                            Apply set_config
                        </Button>
                    </XStack>

                    <XStack gap="$3" flexWrap="wrap">
                        <Text>Matched: {previewDevices.length}</Text>
                        <Text>Total: {batchSummary.total}</Text>
                        <Text>Dispatched: {batchSummary.dispatched}</Text>
                        <Text color="$green10">
                            Accepted: {batchSummary.accepted}
                        </Text>
                        <Text color="$red10">
                            Failed: {batchSummary.failed}
                        </Text>
                    </XStack>
                    <Paragraph color="$gray10">{status}</Paragraph>
                </YStack>

                <YStack
                    borderWidth={1}
                    borderColor="$borderColor"
                    borderRadius="$6"
                    padding="$4"
                    backgroundColor="$color1"
                    gap="$3"
                >
                    <H2 size="$6">Cohort Preview</H2>
                    <ScrollView maxHeight={420}>
                        <YStack gap="$2">
                            {previewDevices.length === 0 ? (
                                <Paragraph color="$gray10">
                                    No devices loaded. Run preview first.
                                </Paragraph>
                            ) : (
                                previewDevices.map((device) => (
                                    <YStack
                                        key={device.deviceId}
                                        borderWidth={1}
                                        borderColor="$borderColor"
                                        borderRadius="$4"
                                        padding="$3"
                                        gap="$1"
                                    >
                                        <XStack
                                            justifyContent="space-between"
                                            alignItems="center"
                                        >
                                            <Text fontWeight="700">
                                                {device.deviceId}
                                            </Text>
                                            <Text
                                                color={
                                                    device.online
                                                        ? "$green10"
                                                        : "$gray10"
                                                }
                                            >
                                                {device.online
                                                    ? "online"
                                                    : "offline"}
                                            </Text>
                                        </XStack>
                                        <Text color="$gray10">
                                            {device.metadata?.name || "-"} ·
                                            site {device.metadata?.site || "-"}{" "}
                                            · zone{" "}
                                            {device.metadata?.zone || "-"}
                                        </Text>
                                        <Text color="$gray10">
                                            fw{" "}
                                            {device.metadata?.firmwareVersion ||
                                                "-"}{" "}
                                            · sensor{" "}
                                            {device.metadata?.sensorVersion ||
                                                "-"}
                                        </Text>
                                    </YStack>
                                ))
                            )}
                        </YStack>
                    </ScrollView>
                </YStack>

                <YStack
                    borderWidth={1}
                    borderColor="$borderColor"
                    borderRadius="$6"
                    padding="$4"
                    backgroundColor="$color1"
                    gap="$3"
                >
                    <XStack
                        justifyContent="space-between"
                        alignItems="center"
                        flexWrap="wrap"
                        gap="$2"
                    >
                        <H2 size="$6">Rollout Console v2</H2>
                        <Text color="$gray10">
                            {loadingRollouts
                                ? "Loading rollouts..."
                                : `${rollouts.length} rollout plans`}
                        </Text>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap">
                        <Input
                            flex={1}
                            minWidth={180}
                            value={rolloutName}
                            onChangeText={setRolloutName}
                            placeholder="Rollout name"
                        />
                        <select
                            value={rolloutStrategy}
                            onChange={(event) =>
                                setRolloutStrategy(
                                    normalizeRolloutStrategy(
                                        event.target.value,
                                    ),
                                )
                            }
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                            }}
                        >
                            <option value="all-at-once">all-at-once</option>
                            <option value="wave">wave</option>
                            <option value="canary">canary</option>
                        </select>
                        <Input
                            width={120}
                            value={rolloutWaveSize}
                            onChangeText={setRolloutWaveSize}
                            placeholder="wave size"
                            keyboardType="numeric"
                        />
                        <Input
                            width={120}
                            value={rolloutCanarySize}
                            onChangeText={setRolloutCanarySize}
                            placeholder="canary size"
                            keyboardType="numeric"
                            disabled={rolloutStrategy !== "canary"}
                        />
                        <Input
                            width={140}
                            value={rolloutIntervalMs}
                            onChangeText={setRolloutIntervalMs}
                            placeholder="interval ms"
                            keyboardType="numeric"
                        />
                        <Button
                            size="$3"
                            theme="blue"
                            onPress={() => void createRolloutPlan()}
                            disabled={rolloutBusy}
                        >
                            Create Plan
                        </Button>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap">
                        <Input
                            width={140}
                            value={rolloutMaxFailureRatio}
                            onChangeText={setRolloutMaxFailureRatio}
                            placeholder="max failure"
                        />
                        <Input
                            width={140}
                            value={rolloutMaxTimeoutRatio}
                            onChangeText={setRolloutMaxTimeoutRatio}
                            placeholder="max timeout"
                        />
                        <Input
                            width={140}
                            value={rolloutMinSuccessRatio}
                            onChangeText={setRolloutMinSuccessRatio}
                            placeholder="min success"
                        />
                        <Text color="$gray10">Gate ratios: 0..1</Text>
                    </XStack>

                    <XStack gap="$2" flexWrap="wrap" alignItems="center">
                        <select
                            value={selectedRolloutId}
                            onChange={(event) => {
                                const planId = event.target.value;
                                setSelectedRolloutId(planId);
                                if (planId) {
                                    const plan = rollouts.find(
                                        (item) => item.planId === planId,
                                    );
                                    setApprovalActionType("rollout_start");
                                    setApprovalResourceId(planId);
                                    setApprovalTargetCount(
                                        String(plan?.targetCount || 0),
                                    );
                                    void loadRolloutDetails(planId);
                                } else {
                                    setRolloutExecution(null);
                                    setRolloutSummary(null);
                                    setRolloutWaves([]);
                                    setRolloutEvents([]);
                                }
                            }}
                            style={{
                                background: "#111827",
                                color: "#e5e7eb",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                padding: "8px 10px",
                                minWidth: 260,
                            }}
                        >
                            <option value="">Select rollout plan...</option>
                            {rollouts.map((item) => (
                                <option key={item.planId} value={item.planId}>
                                    {item.name} ({item.status})
                                </option>
                            ))}
                        </select>
                        <Button
                            size="$3"
                            onPress={() =>
                                void loadRollouts(
                                    selectedRolloutId || undefined,
                                )
                            }
                            disabled={loadingRollouts}
                        >
                            Refresh
                        </Button>
                    </XStack>

                    <Input
                        value={rolloutNote}
                        onChangeText={setRolloutNote}
                        placeholder="Action note (required for pause/cancel/rollback)"
                    />

                    <XStack gap="$2" flexWrap="wrap">
                        <Button
                            size="$3"
                            onPress={() => void rolloutAction("start", false)}
                            disabled={rolloutBusy || !selectedRolloutId}
                        >
                            Start
                        </Button>
                        <Button
                            size="$3"
                            onPress={() => void rolloutAction("pause", true)}
                            disabled={rolloutBusy || !selectedRolloutId}
                        >
                            Pause
                        </Button>
                        <Button
                            size="$3"
                            onPress={() => void rolloutAction("resume", false)}
                            disabled={rolloutBusy || !selectedRolloutId}
                        >
                            Resume
                        </Button>
                        <Button
                            size="$3"
                            theme="orange"
                            onPress={() => void rolloutAction("cancel", true)}
                            disabled={rolloutBusy || !selectedRolloutId}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="$3"
                            theme="red"
                            onPress={() => void rolloutAction("rollback", true)}
                            disabled={rolloutBusy || !selectedRolloutId}
                        >
                            Rollback
                        </Button>
                        <Button
                            size="$3"
                            onPress={() => void processRolloutTick()}
                            disabled={rolloutBusy}
                        >
                            Process Tick
                        </Button>
                    </XStack>

                    {!selectedRolloutPlan ? (
                        <Paragraph color="$gray10">
                            Select a rollout plan to inspect execution waves and
                            events.
                        </Paragraph>
                    ) : (
                        <YStack gap="$3">
                            <XStack gap="$3" flexWrap="wrap">
                                <Text>Plan: {selectedRolloutPlan.name}</Text>
                                <Text>
                                    Strategy: {selectedRolloutPlan.strategy}
                                </Text>
                                <Text>
                                    Target: {selectedRolloutPlan.targetCount}
                                </Text>
                                <Text color="$gray10">
                                    Cohort: {selectedRolloutPlan.cohortRef}
                                </Text>
                                <Text
                                    color={
                                        selectedRolloutPlan.status ===
                                            "completed" ||
                                        selectedRolloutPlan.status ===
                                            "rolled_back"
                                            ? "$green10"
                                            : selectedRolloutPlan.status ===
                                                "running"
                                              ? "$blue10"
                                              : selectedRolloutPlan.status ===
                                                  "failed"
                                                ? "$red10"
                                                : selectedRolloutPlan.status ===
                                                    "paused"
                                                  ? "$yellow10"
                                                  : "$gray10"
                                    }
                                >
                                    Status: {selectedRolloutPlan.status}
                                </Text>
                            </XStack>

                            <XStack gap="$3" flexWrap="wrap">
                                <Text>
                                    Execution:{" "}
                                    {rolloutExecution?.executionId || "-"}
                                </Text>
                                <Text>
                                    Progress: wave{" "}
                                    {rolloutExecution
                                        ? rolloutExecution.currentWaveIndex + 1
                                        : 0}
                                    /{rolloutExecution?.totalWaves || 0}
                                </Text>
                                <Text>
                                    Sent: {rolloutExecution?.sentCount || 0}
                                </Text>
                                <Text color="$green10">
                                    Acked: {rolloutExecution?.ackedCount || 0}
                                </Text>
                                <Text color="$yellow10">
                                    Timeout:{" "}
                                    {rolloutExecution?.timeoutCount || 0}
                                </Text>
                                <Text color="$red10">
                                    Failed: {rolloutExecution?.failedCount || 0}
                                </Text>
                            </XStack>

                            <XStack gap="$3" flexWrap="wrap">
                                <Text>
                                    Median wave:{" "}
                                    {rolloutSummary?.medianWaveDurationMs || 0}{" "}
                                    ms
                                </Text>
                                <Text color="$green10">
                                    Success:{" "}
                                    {formatPercent(
                                        rolloutSummary?.successRatio || 0,
                                    )}
                                </Text>
                                <Text color="$yellow10">
                                    Timeout:{" "}
                                    {formatPercent(
                                        rolloutSummary?.timeoutRatio || 0,
                                    )}
                                </Text>
                                <Text color="$red10">
                                    Failure:{" "}
                                    {formatPercent(
                                        rolloutSummary?.failureRatio || 0,
                                    )}
                                </Text>
                            </XStack>

                            <XStack gap="$3" flexWrap="wrap">
                                <YStack
                                    borderWidth={1}
                                    borderColor="$borderColor"
                                    borderRadius="$4"
                                    padding="$3"
                                    gap="$2"
                                    flex={1}
                                    minWidth={320}
                                >
                                    <Text fontWeight="700">Wave Timeline</Text>
                                    <ScrollView maxHeight={320}>
                                        <YStack gap="$2">
                                            {rolloutWaves.length === 0 ? (
                                                <Paragraph color="$gray10">
                                                    No waves yet.
                                                </Paragraph>
                                            ) : (
                                                rolloutWaves.map((wave) => (
                                                    <YStack
                                                        key={wave.waveId}
                                                        borderWidth={1}
                                                        borderColor="$borderColor"
                                                        borderRadius="$3"
                                                        padding="$2"
                                                        gap="$1"
                                                    >
                                                        <XStack
                                                            justifyContent="space-between"
                                                            gap="$2"
                                                            flexWrap="wrap"
                                                        >
                                                            <Text fontWeight="700">
                                                                {wave.label} (#
                                                                {wave.index + 1}
                                                                )
                                                            </Text>
                                                            <Text
                                                                color={
                                                                    wave.status ===
                                                                        "completed" ||
                                                                    wave.status ===
                                                                        "rolled_back"
                                                                        ? "$green10"
                                                                        : wave.status ===
                                                                            "running"
                                                                          ? "$blue10"
                                                                          : wave.status ===
                                                                              "failed"
                                                                            ? "$red10"
                                                                            : "$gray10"
                                                                }
                                                            >
                                                                {wave.status}
                                                            </Text>
                                                        </XStack>
                                                        <Text color="$gray10">
                                                            target{" "}
                                                            {wave.targetCount} ·
                                                            sent{" "}
                                                            {wave.sentCount} ·
                                                            acked{" "}
                                                            {wave.ackedCount} ·
                                                            timeout{" "}
                                                            {wave.timeoutCount}
                                                            {" · "}
                                                            failed{" "}
                                                            {wave.failedCount}
                                                        </Text>
                                                        <Text color="$gray10">
                                                            gate:{" "}
                                                            {wave.gateDecision ||
                                                                "-"}
                                                        </Text>
                                                        <Text color="$gray10">
                                                            {formatTimestamp(
                                                                wave.startedAt,
                                                            )}{" "}
                                                            {"->"}{" "}
                                                            {formatTimestamp(
                                                                wave.completedAt,
                                                            )}
                                                        </Text>
                                                    </YStack>
                                                ))
                                            )}
                                        </YStack>
                                    </ScrollView>
                                </YStack>

                                <YStack
                                    borderWidth={1}
                                    borderColor="$borderColor"
                                    borderRadius="$4"
                                    padding="$3"
                                    gap="$2"
                                    flex={1}
                                    minWidth={320}
                                >
                                    <Text fontWeight="700">Event Timeline</Text>
                                    <ScrollView maxHeight={320}>
                                        <YStack gap="$2">
                                            {rolloutEvents.length === 0 ? (
                                                <Paragraph color="$gray10">
                                                    No events yet.
                                                </Paragraph>
                                            ) : (
                                                rolloutEvents.map((event) => (
                                                    <YStack
                                                        key={event.eventId}
                                                        borderWidth={1}
                                                        borderColor="$borderColor"
                                                        borderRadius="$3"
                                                        padding="$2"
                                                        gap="$1"
                                                    >
                                                        <XStack
                                                            justifyContent="space-between"
                                                            gap="$2"
                                                            flexWrap="wrap"
                                                        >
                                                            <Text fontWeight="700">
                                                                {event.type}
                                                            </Text>
                                                            <Text color="$gray10">
                                                                {formatTimestamp(
                                                                    event.createdAt,
                                                                )}
                                                            </Text>
                                                        </XStack>
                                                        <Text color="$gray10">
                                                            {event.actor}
                                                        </Text>
                                                        <Text>
                                                            {event.message}
                                                        </Text>
                                                    </YStack>
                                                ))
                                            )}
                                        </YStack>
                                    </ScrollView>
                                </YStack>
                            </XStack>
                        </YStack>
                    )}
                </YStack>
            </YStack>
        </Theme>
    );
}
