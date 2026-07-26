import { useMemo } from "react";
import { cn } from "../../lib/cn";

export interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  /** "unified" (default) or "split". */
  mode?: "unified" | "split";
  title?: string;
  className?: string;
  maxHeight?: string;
}

type DiffOp = "eq" | "add" | "del";
interface DiffRow {
  op: DiffOp;
  oldNum?: number;
  newNum?: number;
  text: string;
}

/** Minimal LCS line diff — no external dependency. */
function diffLines(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let oldNum = 1;
  let newNum = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: "eq", oldNum: oldNum++, newNum: newNum++, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ op: "del", oldNum: oldNum++, text: a[i++] });
    } else {
      rows.push({ op: "add", newNum: newNum++, text: b[j++] });
    }
  }
  while (i < n) rows.push({ op: "del", oldNum: oldNum++, text: a[i++] });
  while (j < m) rows.push({ op: "add", newNum: newNum++, text: b[j++] });
  return rows;
}

const rowBg: Record<DiffOp, string> = {
  eq: "",
  add: "bg-primary/10",
  del: "bg-danger-500/10",
};
const sign: Record<DiffOp, string> = { eq: " ", add: "+", del: "-" };

export function DiffViewer({
  oldValue,
  newValue,
  mode = "unified",
  title,
  className,
  maxHeight = "24rem",
}: DiffViewerProps) {
  const rows = useMemo(
    () => diffLines(oldValue.split("\n"), newValue.split("\n")),
    [oldValue, newValue],
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg   bg-[var(--terminal-bg)] text-[var(--terminal-fg)] font-mono text-sm",
        className,
      )}
    >
      {title && (
        <div className="  px-4 py-2 text-xs text-neutral-400">{title}</div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        {mode === "unified" ? (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className={rowBg[r.op]}>
                  <td className="select-none px-2 text-right text-neutral-600">{r.oldNum ?? ""}</td>
                  <td className="select-none px-2 text-right text-neutral-600">{r.newNum ?? ""}</td>
                  <td className="select-none pr-2 text-neutral-500">{sign[r.op]}</td>
                  <td className="w-full whitespace-pre-wrap break-words pr-4">{r.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td className="select-none px-2 text-right text-neutral-600">{r.oldNum ?? ""}</td>
                  <td className={cn("w-1/2 whitespace-pre-wrap break-words pr-4", r.op === "del" && rowBg.del)}>
                    {r.op !== "add" ? r.text || " " : ""}
                  </td>
                  <td className="select-none px-2 text-right text-neutral-600">{r.newNum ?? ""}</td>
                  <td className={cn("w-1/2 whitespace-pre-wrap break-words pr-4", r.op === "add" && rowBg.add)}>
                    {r.op !== "del" ? r.text || " " : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
