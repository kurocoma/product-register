export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">商品編集 [{id}]</h1>
      <p className="text-sm text-slate-500 mt-2">Plan 3/4 で実装予定</p>
    </div>
  );
}
