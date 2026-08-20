"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deskHeaders, deskToken, setDeskToken } from "@/lib/desk-token";
import type {
  SearchHit,
  SearchResult,
  SearchScope,
  UniverseItem,
  UniversePayload,
  UniversePreviewResult,
} from "@/lib/types";

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "tracked", label: "已追踪" },
  { id: "us", label: "美股" },
  { id: "hk", label: "港股" },
];

const AUTH_ERROR = "未配置或口令不对。在服务器设置 DESK_EDIT_TOKEN，并在此填入相同口令。";

type PreviewState = {
  hitId: string;
  item: UniverseItem;
  benchmarks: readonly string[];
  benchmark: string;
};

export function UniversePanel({
  open,
  payload,
  generating,
  onClose,
  onChanged,
}: {
  open: boolean;
  payload: UniversePayload;
  generating: boolean;
  onClose: () => void;
  onChanged: (next: UniversePayload, extra?: { started?: boolean }) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [editToken, setEditToken] = useState(() => deskToken());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useMemo(() => new Set(payload.pendingIds), [payload.pendingIds]);
  const protectedIds = useMemo(
    () => new Set(payload.referencedBenchmarks),
    [payload.referencedBenchmarks],
  );
  const full = payload.items.length >= 80;
  const trimmed = query.trim();
  const isSearch = trimmed.length > 0;

  const us = useMemo(() => {
    const list = payload.items.filter((item) => item.market === "US");
    if (scope === "hk") return [];
    return list;
  }, [payload.items, scope]);

  const hk = useMemo(() => {
    const list = payload.items.filter((item) => item.market === "HK");
    if (scope === "us") return [];
    return list;
  }, [payload.items, scope]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !trimmed) return;

    const ac = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/universe/search?q=${encodeURIComponent(trimmed)}&scope=${scope}`,
          { cache: "no-store", signal: ac.signal },
        );
        const body = (await res.json()) as SearchResult;
        if (ac.signal.aborted) return;
        setHits(body.hits ?? []);
        setSearchNote(body.note ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!ac.signal.aborted) {
          setHits([]);
          setSearchNote(null);
        }
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [open, trimmed, scope]);

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/universe", {
        method: "DELETE",
        headers: deskHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id }),
      });
      const body = (await res.json()) as UniversePayload & { error?: string };
      if (res.status === 401) {
        setError(AUTH_ERROR);
        setConfirmId(null);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "移除失败");
        setConfirmId(null);
        return;
      }
      setConfirmId(null);
      onChanged(body);
    } catch {
      setError("移除失败");
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function openPreview(hit: SearchHit) {
    if (hit.tracked || full) return;
    setError(null);
    setConfirmId(null);
    setPreviewBusyId(hit.id);
    try {
      const res = await fetch("/api/universe/preview", {
        method: "POST",
        headers: deskHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ yahoo: hit.yahoo, market: hit.market }),
      });
      const body = (await res.json()) as UniversePreviewResult & { error?: string };
      if (res.status === 401) {
        setError(AUTH_ERROR);
        setPreview(null);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "核验失败，没有报价");
        setPreview(null);
        return;
      }
      if (body.tracked) {
        setPreview(null);
        return;
      }
      setPreview({
        hitId: hit.id,
        item: body.item,
        benchmarks: body.benchmarks,
        benchmark: body.item.benchmark,
      });
    } catch {
      setError("核验失败，没有报价");
      setPreview(null);
    } finally {
      setPreviewBusyId(null);
    }
  }

  async function add(run: boolean) {
    if (!preview || addBusy) return;
    setAddBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/universe", {
        method: "POST",
        headers: deskHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          yahoo: preview.item.yahoo,
          market: preview.item.market,
          name: preview.item.name,
          benchmark: preview.benchmark,
          group: preview.item.group,
          run,
        }),
      });
      const body = (await res.json()) as UniversePayload & {
        started?: boolean;
        error?: string;
      };
      if (res.status === 401) {
        setError(AUTH_ERROR);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "加入失败");
        return;
      }
      const next: UniversePayload = {
        items: body.items,
        pendingIds: body.pendingIds,
        reportIds: body.reportIds,
        referencedBenchmarks: body.referencedBenchmarks,
        staleStats: body.staleStats,
      };
      setPreview(null);
      setQuery("");
      setHits([]);
      setSearchNote(null);
      if (run && body.started) {
        onChanged(next, { started: true });
      } else if (run && !body.started) {
        onChanged(next);
        setError("晨报正在生成，已加入，待这次跑完或明天纳入。");
      } else {
        onChanged(next);
      }
    } catch {
      setError("加入失败");
    } finally {
      setAddBusy(false);
    }
  }

  if (!open) return null;

  function row(item: UniverseItem) {
    const isProtected = protectedIds.has(item.id) || protectedIds.has(item.yahoo);
    const isPending = pending.has(item.id);
    const confirming = confirmId === item.id;
    return (
      <li key={item.id} className="roster-row">
        <span className="roster-who">
          <span className="sym">{item.display}</span>
          <span className="name">{item.name}</span>
        </span>
        <span className="roster-end">
          {isProtected ? (
            <span
              className="muted"
              title="其它证券的主基准，不能移除"
              aria-label="其它证券的主基准，不能移除"
            >
              基准
            </span>
          ) : confirming ? (
            <>
              <button
                type="button"
                className="ghost roster-remove"
                disabled={busyId === item.id}
                onClick={() => remove(item.id)}
              >
                确认移除
              </button>
              <button
                type="button"
                className="roster-cancel"
                disabled={busyId === item.id}
                onClick={() => setConfirmId(null)}
              >
                取消
              </button>
            </>
          ) : (
            <>
              {isPending ? <span className="muted">待纳入</span> : null}
              <button
                type="button"
                className="roster-remove"
                onClick={() => {
                  setError(null);
                  setPreview(null);
                  setConfirmId(item.id);
                }}
              >
                移除
              </button>
            </>
          )}
        </span>
      </li>
    );
  }

  function hitRow(hit: SearchHit) {
    const confirming = preview?.hitId === hit.id;
    return (
      <li key={hit.id} className="roster-hit">
        <div className="roster-row">
          <span className="roster-who">
            <span className="sym">{hit.display}</span>
            <span className="name">{hit.name}</span>
          </span>
          <span className="roster-end">
            {hit.tracked ? (
              <span className="muted">已追踪</span>
            ) : full ? null : (
              <button
                type="button"
                className="roster-remove"
                disabled={previewBusyId === hit.id || addBusy}
                onClick={() => openPreview(hit)}
              >
                加入
              </button>
            )}
          </span>
        </div>
        {confirming && preview ? (
          <div className="roster-confirm">
            <div className="roster-confirm-row">
              <span className="roster-confirm-label">名称</span>
              <span>{preview.item.name}</span>
            </div>
            <div className="roster-confirm-row">
              <span className="roster-confirm-label">市场</span>
              <span>{preview.item.market === "US" ? "美股" : "港股"}</span>
            </div>
            <div className="roster-confirm-row">
              <span className="roster-confirm-label">主基准</span>
              <select
                className="date-pick"
                value={preview.benchmark}
                disabled={addBusy}
                onChange={(e) =>
                  setPreview((prev) =>
                    prev ? { ...prev, benchmark: e.target.value } : prev,
                  )
                }
              >
                {preview.benchmarks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="roster-confirm-actions">
              <button
                type="button"
                className="primary"
                disabled={addBusy || generating}
                onClick={() => add(true)}
              >
                加入并生成
              </button>
              <button
                type="button"
                className="ghost"
                disabled={addBusy}
                onClick={() => add(false)}
              >
                明天纳入
              </button>
            </div>
            {generating ? (
              <p className="muted roster-confirm-note">晨报正在生成，只能明天纳入。</p>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="roster" role="dialog" aria-modal="true" aria-labelledby="roster-title">
      <button
        type="button"
        className="roster-back"
        aria-label="关闭名单"
        onClick={onClose}
      />
      <div className="roster-sheet">
        <div className="roster-head">
          <div>
            <p className="eyebrow">追踪名单</p>
            <h2 id="roster-title">桌上这些</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="roster-note muted">加入可选现在重跑或等明早；移除不重跑。</p>
        <input
          className="roster-search ghost"
          type="password"
          value={editToken}
          placeholder="写入口令"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            const next = e.target.value;
            setEditToken(next);
            setDeskToken(next);
          }}
        />
        <p className="muted footnote">公网写入需要口令；只存在这台浏览器。</p>
        <input
          ref={searchRef}
          className="roster-search"
          type="search"
          value={query}
          placeholder="代码或名称，港股 / 美股"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setPreview(null);
            setConfirmId(null);
          }}
        />
        <div className="roster-scopes" role="tablist" aria-label="搜索范围">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              aria-current={scope === s.id ? "true" : undefined}
              onClick={() => {
                setScope(s.id);
                setPreview(null);
                setConfirmId(null);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        {error ? <p className="roster-error">{error}</p> : null}
        {full ? <p className="footnote">名单已满（80）</p> : null}
        <div className="roster-list">
          {isSearch ? (
            <div>
              <p className="eyebrow">搜索结果</p>
              {searchNote ? <p className="footnote">{searchNote}</p> : null}
              {!searching && hits.length === 0 && !searchNote ? (
                <p className="muted footnote">无匹配</p>
              ) : null}
              {hits.length ? <ul>{hits.map(hitRow)}</ul> : null}
            </div>
          ) : (
            <>
              {us.length ? (
                <div>
                  <p className="eyebrow">美股</p>
                  <ul>{us.map(row)}</ul>
                </div>
              ) : null}
              {hk.length ? (
                <div>
                  <p className="eyebrow">港股</p>
                  <ul>{hk.map(row)}</ul>
                </div>
              ) : null}
            </>
          )}
        </div>
        {payload.staleStats ? (
          <p className="footnote">名单已改，判断与涨跌家数待下次生成。</p>
        ) : null}
      </div>
    </div>
  );
}
