/**
 * The five programs as their IDLs describe them — instructions (docs, accounts, args), account
 * types, events and errors — read from the same JSON the generated client was built from.
 */
import { useState } from "react";
import auctionIdl from "../../../../sdk/idl/window_auction.json";
import creditIdl from "../../../../sdk/idl/window_credit.json";
import oracleIdl from "../../../../sdk/idl/window_oracle.json";
import registryIdl from "../../../../sdk/idl/window_registry.json";
import wrapIdl from "../../../../sdk/idl/window_wrap.json";
import { Badge, ExplorerLink } from "../../components/ui";
import { config } from "../../config";

type IdlType =
  | string
  | { array: [IdlType, number] }
  | { defined: { name: string } }
  | { vec: IdlType }
  | { option: IdlType };
interface IdlField {
  name: string;
  type: IdlType;
  docs?: string[];
}
interface Idl {
  address: string;
  metadata: { name: string; version: string; description?: string };
  instructions: Array<{
    name: string;
    docs?: string[];
    accounts: Array<{ name: string; writable?: boolean; signer?: boolean; pda?: unknown; optional?: boolean }>;
    args: IdlField[];
  }>;
  accounts: Array<{ name: string }>;
  events: Array<{ name: string }>;
  errors: Array<{ code: number; name: string; msg?: string }>;
  types: Array<{
    name: string;
    docs?: string[];
    type: { kind: string; fields?: IdlField[]; variants?: Array<{ name: string }> };
  }>;
}

const IDLS: Array<{ key: string; idl: Idl }> = [
  { key: "registry", idl: registryIdl as unknown as Idl },
  { key: "auction", idl: auctionIdl as unknown as Idl },
  { key: "oracle", idl: oracleIdl as unknown as Idl },
  { key: "wrap", idl: wrapIdl as unknown as Idl },
  { key: "credit", idl: creditIdl as unknown as Idl },
];

export function renderType(t: IdlType): string {
  if (typeof t === "string") return t;
  if ("array" in t) return `[${renderType(t.array[0])}; ${t.array[1]}]`;
  if ("defined" in t) return t.defined.name;
  if ("vec" in t) return `Vec<${renderType(t.vec)}>`;
  if ("option" in t) return `Option<${renderType(t.option)}>`;
  return "?";
}

/** Snake to the generated client's camelCase, so a developer can find the function. */
export const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const pascal = (s: string) => camel(s).replace(/^[a-z]/, (c) => c.toUpperCase());

function Fields({ fields }: { fields: IdlField[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
      {fields.map((f) => (
        <div key={f.name} className="contents">
          <dt className="mono text-ink-2">{camel(f.name)}</dt>
          <dd className="text-ink-3">
            <span className="mono text-ink-1">{renderType(f.type)}</span>
            {f.docs && <span> — {f.docs.join(" ")}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgramSurface() {
  const [key, setKey] = useState("auction");
  const [section, setSection] = useState<"instructions" | "accounts" | "events" | "errors">("instructions");
  const current = IDLS.find((i) => i.key === key) ?? IDLS[1];
  if (!current) return null;
  const { idl } = current;
  const typeOf = (name: string) => idl.types.find((t) => t.name === name);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1">
        {IDLS.map((i) => (
          <button
            type="button"
            key={i.key}
            onClick={() => setKey(i.key)}
            className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-sm [@media(pointer:coarse)]:min-h-11 ${key === i.key ? "bg-surface-2 text-ink-1" : "text-ink-3 hover:text-ink-1"}`}
          >
            window_{i.key}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-3">
          v{idl.metadata.version} · <ExplorerLink address={idl.address} cluster={config.cluster} />
        </span>
      </div>
      {idl.metadata.description && <p className="text-xs text-ink-2">{idl.metadata.description}</p>}
      <div className="flex gap-1 border-b border-line">
        {(["instructions", "accounts", "events", "errors"] as const).map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setSection(s)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs [@media(pointer:coarse)]:min-h-11 ${section === s ? "border-accent text-ink-1" : "border-transparent text-ink-3 hover:text-ink-1"}`}
          >
            {s} <span className="mono text-ink-3">{idl[s].length}</span>
          </button>
        ))}
      </div>

      {section === "instructions" && (
        <ul className="grid gap-3">
          {idl.instructions.map((ix) => (
            <li key={ix.name} className="rounded-[var(--radius-md)] border border-line bg-surface-0 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="mono text-sm text-ink-1">{ix.name}</span>
                <span className="mono text-[11px] text-ink-3">
                  sdk.{key}.get{pascal(ix.name)}Instruction(…)
                </span>
              </div>
              {ix.docs && <p className="mt-1 text-xs text-ink-2">{ix.docs.join(" ")}</p>}
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">accounts</div>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {ix.accounts.map((a) => (
                      <li
                        key={a.name}
                        className="mono flex items-center gap-1 rounded-[var(--radius-sm)] border border-line px-1.5 py-0.5 text-[11px] text-ink-2"
                      >
                        {a.name}
                        {a.signer && <Badge tone="accent">signer</Badge>}
                        {a.writable && <Badge tone="warn">mut</Badge>}
                        {a.pda ? <Badge>pda</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">args</div>
                  {ix.args.length === 0 ? (
                    <p className="mt-1 text-xs text-ink-3">none</p>
                  ) : (
                    <div className="mt-1">
                      <Fields fields={ix.args} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {section === "accounts" && (
        <ul className="grid gap-3">
          {idl.accounts.map((a) => {
            const t = typeOf(a.name);
            return (
              <li key={a.name} className="rounded-[var(--radius-md)] border border-line bg-surface-0 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="mono text-sm text-ink-1">{a.name}</span>
                  <span className="mono text-[11px] text-ink-3">
                    sdk.{key}.fetchMaybe{a.name}(rpc, address) · sdk.{key}.decode{a.name}(account)
                  </span>
                </div>
                {t?.docs && <p className="mt-1 text-xs text-ink-2">{t.docs.join(" ")}</p>}
                {t?.type.fields && (
                  <div className="mt-2">
                    <Fields fields={t.type.fields} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {section === "events" && (
        <ul className="grid gap-3">
          {idl.events.map((e) => {
            const t = typeOf(e.name);
            return (
              <li key={e.name} className="rounded-[var(--radius-md)] border border-line bg-surface-0 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="mono text-sm text-ink-1">{e.name}</span>
                  <span className="mono text-[11px] text-ink-3">
                    sdk.{key}.parse{e.name}Event(bytes)
                  </span>
                </div>
                {t?.type.fields && (
                  <div className="mt-2">
                    <Fields fields={t.type.fields} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {section === "errors" && (
        <dl className="grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-1 text-xs">
          {idl.errors.map((e) => (
            <div key={e.code} className="contents">
              <dt className="mono text-ink-3">{e.code}</dt>
              <dd className="mono text-ink-1">{e.name}</dd>
              <dd className="text-ink-2">{e.msg}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
