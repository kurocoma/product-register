"use client";

import type { CodexRuleProposal } from "@/lib/rule-audit/codex-client";

export type CodexProposalCurrent = {
  sale_description_pc: string;
  description_pc: string;
  description_sp: string;
  image_order: string[];
};

type TextField = "sale_description_pc" | "description_pc" | "description_sp";

const TEXT_FIELD_LABEL: Record<TextField, string> = {
  sale_description_pc: "PC用販売説明文（楽天）",
  description_pc: "商品説明 PC",
  description_sp: "商品説明 スマホ",
};

export function CodexProposalDiff({
  current,
  proposal,
  onApprove,
  onCancel,
}: {
  current: CodexProposalCurrent;
  proposal: CodexRuleProposal;
  onApprove: (proposal: CodexRuleProposal) => void;
  onCancel: () => void;
}) {
  const changedTextFields = (
    Object.keys(TEXT_FIELD_LABEL) as TextField[]
  ).filter((field) => current[field] !== proposal[field]);
  const imageOrderChanged = !sameStrings(current.image_order, proposal.image_order);
  const hasChanges =
    changedTextFields.length > 0 ||
    imageOrderChanged ||
    proposal.image_naming_changes.length > 0;

  return (
    <div className="space-y-4 rounded border border-violet-200 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-violet-950">Codex提案の差分</div>
          <p className="text-xs text-violet-700">
            承認すると下の提案値を未保存フォームへ反映します。
          </p>
        </div>
        <span className="rounded-full bg-violet-100 px-2 py-1 text-xs text-violet-800">
          {hasChanges ? "変更あり" : "変更なし"}
        </span>
      </div>

      {changedTextFields.length > 0 ? (
        <div className="space-y-3">
          {changedTextFields.map((field) => (
            <TextDiff
              key={field}
              label={TEXT_FIELD_LABEL[field]}
              before={current[field]}
              after={proposal[field]}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">説明文HTMLの変更はありません。</p>
      )}

      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="mb-2 text-sm font-medium text-slate-800">画像URLの並び順</div>
        {imageOrderChanged ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <ImageOrder title="現状" urls={current.image_order} muted />
            <ImageOrder title="提案" urls={proposal.image_order} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">画像URLの並び順に変更はありません。</p>
        )}
      </div>

      {proposal.image_naming_changes.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 text-sm font-medium text-amber-900">画像命名の変更案</div>
          <ul className="space-y-2 text-xs">
            {proposal.image_naming_changes.map((change, index) => (
              <li key={change.from + "\u0000" + change.to + index}>
                <div className="break-all text-slate-500 line-through">{change.from}</div>
                <div className="break-all text-amber-900">→ {change.to}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-medium text-amber-900">
            ※ 承認時は画像URLの順序だけをフォームへ反映します。命名変更には次フェーズで実ファイルの再アップロードが必要です。
          </p>
        </div>
      )}

      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="mb-1 text-sm font-medium text-slate-800">判断メモ</div>
        <p className="whitespace-pre-wrap text-xs text-slate-700">{proposal.notes}</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
        >
          取り消す
        </button>
        <button
          type="button"
          onClick={() => onApprove(proposal)}
          disabled={!hasChanges}
          className="rounded bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          提案を承認してフォームへ反映
        </button>
      </div>
    </div>
  );
}

function TextDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 text-sm font-medium text-slate-800">{label}</div>
      <div className="grid gap-3 lg:grid-cols-2">
        <DiffValue title="現状" value={before} muted />
        <DiffValue title="提案" value={after} />
      </div>
    </div>
  );
}

function DiffValue({
  title,
  value,
  muted = false,
}: {
  title: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <pre
        className={
          "max-h-52 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs " +
          (muted
            ? "border-slate-200 bg-slate-50 text-slate-500"
            : "border-violet-200 bg-violet-50 text-violet-950")
        }
      >
        {value || "（空欄）"}
      </pre>
    </div>
  );
}

function ImageOrder({
  title,
  urls,
  muted = false,
}: {
  title: string;
  urls: string[];
  muted?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      {urls.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
          （画像URLなし）
        </div>
      ) : (
        <ol
          className={
            "max-h-52 list-decimal space-y-1 overflow-auto rounded border py-2 pl-8 pr-2 text-xs " +
            (muted
              ? "border-slate-200 bg-slate-50 text-slate-500"
              : "border-violet-200 bg-violet-50 text-violet-950")
          }
        >
          {urls.map((url, index) => (
            <li key={url + "\u0000" + index} className="break-all">
              {url}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
