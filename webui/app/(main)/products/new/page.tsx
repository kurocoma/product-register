import { NewProductClient } from "@/components/product/NewProductClient";

/** 新規商品作成ページ。?template=<id> でテンプレートを初期選択＆自動適用する
 * （テンプレート管理の「このテンプレートで新規作成」から遷移）。 */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  return <NewProductClient initialTemplateId={template} />;
}
