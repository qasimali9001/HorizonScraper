import { WorldDetail } from "./worldDetail";

export default async function WorldPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorldDetail worldId={id} />;
}

