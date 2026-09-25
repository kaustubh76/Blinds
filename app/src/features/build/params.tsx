/**
 * The inputs for a recipe's declared parameters.
 *
 * The spec in `recipes.ts` is the single source of truth: this renders it, and the recipe's own `code`
 * and `run` read the value back through `ctx.p`. That is the whole arrangement — a snippet cannot show
 * one number while the run uses another, because neither holds a literal.
 *
 * Values persist per recipe in the same preference namespace as everything else, so a reload keeps the
 * loan size you were working with. "Reset to defaults" in Settings forgets them along with the rest.
 */

import { Field, inputCls } from "../../components/ui";
import { readPrefValue, writePrefValue } from "../../lib/prefs";
import { defaultValues, type ParamSpec, type RecipeCtx } from "./recipes";

const key = (recipeId: string, paramKey: string) => `recipe.${recipeId}.${paramKey}`;

/** What a recipe starts with: whatever was last typed here, else its declared defaults. */
export function storedValues(recipeId: string, specs: readonly ParamSpec[] | undefined): Record<string, string> {
  const out = defaultValues(specs);
  for (const sp of specs ?? []) out[sp.key] = readPrefValue(key(recipeId, sp.key), String(sp.default));
  return out;
}

export function ParamFields({
  recipeId,
  specs,
  values,
  onChange,
  ctx,
}: {
  recipeId: string;
  specs: readonly ParamSpec[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  ctx: RecipeCtx;
}) {
  const set = (k: string, v: string) => {
    writePrefValue(key(recipeId, k), v);
    onChange({ ...values, [k]: v });
  };
  return (
    <div className="mt-3 grid gap-3 rounded-[var(--radius-md)] border border-line bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
      {specs.map((sp) => {
        const id = `p-${recipeId}-${sp.key}`;
        const value = values[sp.key] ?? String(sp.default);
        return (
          <Field key={sp.key} label={sp.label} {...(sp.hint ? { hint: sp.hint } : {})}>
            {sp.kind === "choice" ? (
              <select
                id={id}
                className={inputCls}
                value={value}
                onChange={(e) => set(sp.key, e.target.value)}
                aria-label={`${sp.label} for ${recipeId}`}
              >
                {sp.choices(ctx).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : sp.kind === "text" ? (
              <input
                id={id}
                className={inputCls}
                value={value}
                placeholder={sp.placeholder ?? ""}
                onChange={(e) => set(sp.key, e.target.value)}
                aria-label={`${sp.label} for ${recipeId}`}
              />
            ) : (
              <input
                id={id}
                type="number"
                className={inputCls}
                value={value}
                {...(sp.kind === "int" && sp.min !== undefined ? { min: sp.min } : {})}
                {...(sp.kind === "int" && sp.max !== undefined ? { max: sp.max } : {})}
                onChange={(e) => set(sp.key, e.target.value)}
                aria-label={`${sp.label} for ${recipeId}`}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
