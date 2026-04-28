#!/usr/bin/env python3
from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path
from typing import Iterable

from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.export import to_json
from graphify.extract import collect_files, extract
from graphify.report import generate


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ROOTS = ("server/src", "server/client/src")
OUTPUT_DIR_NAME = "graphify-out"


def _resolve_roots(roots: Iterable[str]) -> list[Path]:
  resolved: list[Path] = []
  for root in roots:
    path = (REPO_ROOT / root).resolve()
    if path.exists():
      resolved.append(path)
  return resolved


def _collect_source_files(roots: Iterable[Path]) -> list[Path]:
  files: list[Path] = []
  for root in roots:
    files.extend(collect_files(root))

  unique_sorted = sorted({path.resolve() for path in files if path.is_file()})
  return [Path(path) for path in unique_sorted]


def _snapshot_mtime(files: Iterable[Path]) -> dict[str, int]:
  snapshot: dict[str, int] = {}
  for path in files:
    try:
      snapshot[str(path)] = path.stat().st_mtime_ns
    except FileNotFoundError:
      continue
  return snapshot


def rebuild_source_only(roots: list[Path], out_dir: Path) -> tuple[int, int, int, int]:
  code_files = _collect_source_files(roots)
  if not code_files:
    raise RuntimeError("No source files found under selected roots.")

  result = extract(code_files)
  graph = build_from_json(result)
  communities = cluster(graph)
  cohesion = score_all(graph, communities)
  gods = god_nodes(graph)
  surprises = surprising_connections(graph, communities)
  labels = {cid: f"Community {cid}" for cid in communities}
  questions = suggest_questions(graph, communities, labels)

  out_dir.mkdir(parents=True, exist_ok=True)
  report = generate(
    graph,
    communities,
    cohesion,
    labels,
    gods,
    surprises,
    {
      "files": {
        "code": [str(path) for path in code_files],
        "document": [],
        "paper": [],
        "image": [],
      },
      "total_files": len(code_files),
      "total_words": 0,
    },
    {"input": 0, "output": 0},
    str(REPO_ROOT),
    suggested_questions=questions,
  )
  (out_dir / "GRAPH_REPORT.md").write_text(report)
  to_json(graph, communities, str(out_dir / "graph.json"))

  return (
    len(code_files),
    graph.number_of_nodes(),
    graph.number_of_edges(),
    len(communities),
  )


def main() -> int:
  parser = argparse.ArgumentParser(
    description="Rebuild graphify output from source folders only (skip node_modules and build outputs).",
  )
  parser.add_argument(
    "--roots",
    nargs="+",
    default=list(DEFAULT_SOURCE_ROOTS),
        help="Relative source roots to scan (default: server/src server/client/src).",
  )
  parser.add_argument(
    "--watch",
    action="store_true",
    help="Watch source roots and auto-rebuild when file changes are detected.",
  )
  parser.add_argument(
    "--interval",
    type=float,
    default=2.0,
    help="Polling interval in seconds for --watch (default: 2.0).",
  )
  args = parser.parse_args()

  roots = _resolve_roots(args.roots)
  if not roots:
    print("[graphify source-only] No valid source roots found.", file=sys.stderr)
    return 1

  out_dir = REPO_ROOT / OUTPUT_DIR_NAME

  try:
    files, nodes, edges, communities = rebuild_source_only(roots, out_dir)
    print(
      f"[graphify source-only] rebuilt files={files} nodes={nodes} edges={edges} communities={communities}",
    )
    print(f"[graphify source-only] output={out_dir}")
  except Exception as exc:  # pragma: no cover
    print(f"[graphify source-only] rebuild failed: {exc}", file=sys.stderr)
    return 1

  if not args.watch:
    return 0

  print(
    f"[graphify source-only] watching roots: {', '.join(str(path) for path in roots)}"
    f" (interval={args.interval}s, Ctrl+C to stop)",
  )

  stop_requested = False

  def _handle_stop(_: int, __) -> None:
    nonlocal stop_requested
    stop_requested = True

  signal.signal(signal.SIGINT, _handle_stop)
  signal.signal(signal.SIGTERM, _handle_stop)

  previous_snapshot = _snapshot_mtime(_collect_source_files(roots))
  while not stop_requested:
    time.sleep(max(0.25, args.interval))
    current_files = _collect_source_files(roots)
    current_snapshot = _snapshot_mtime(current_files)
    if current_snapshot == previous_snapshot:
      continue

    previous_snapshot = current_snapshot
    try:
      files, nodes, edges, communities = rebuild_source_only(roots, out_dir)
      print(
        f"[graphify source-only] updated files={files} nodes={nodes} edges={edges} communities={communities}",
      )
    except Exception as exc:  # pragma: no cover
      print(f"[graphify source-only] update failed: {exc}", file=sys.stderr)

  print("[graphify source-only] stopped")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
