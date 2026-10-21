import { notFound } from "next/navigation";
import { ColourForm } from "@/components/colours/colour-form";
import { getColourFormForToken } from "@/server/colour-selections";
import { saveColoursAction, signColoursAction } from "./actions";

// An expired or withdrawn link must stop working on the next request.
export const dynamic = "force-dynamic";

export default async function CustomerColourFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getColourFormForToken(token);
  if (!data) notFound();
  return <ColourForm data={data} mode="customer" save={saveColoursAction.bind(null, token)} sign={signColoursAction.bind(null, token)} />;
}
