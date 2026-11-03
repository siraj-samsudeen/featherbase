# ADR Review Manifest

- Status: completed
- Review date: 2026-11-01

## Review Summary

ADR review completed for this change. The shared sidebar extends the existing shadow-root rendering pattern while app data, callbacks and document ownership remain app-owned. No major durable architectural decision beyond the existing platform/app boundary is introduced; no new repository-level ADR is created.

## In-Force ADRs Reviewed

- 0005, 0006, 0007, 0009: naming, stack, database topology and record identity remain unchanged.
- 0010 and its schema amendment in 0015: OpenSpec remains the behavior contract.
- 0011, amended by 0013 and 0014: platform/app/instance separation and one-way knowledge remain in force.
- 0012: test through public behavior and remove retired navigation code.
- 0014, except portions superseded by 0015: apps remain separate packages in this repository.
- 0015: accepted ADRs are immutable.

## New Durable ADRs Created

- None.
