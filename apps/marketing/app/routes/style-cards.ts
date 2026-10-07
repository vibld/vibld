/**
 * One chunk of the style cards' previews (app/style-cards.ts), as JSON by
 * style id. Prerendered to a file; the /templates gallery fetches it when a
 * reader reaches a card it holds.
 */
export async function loader({ request }: { request: Request }) {
  const n = Number(/(\d+)\.json$/.exec(new URL(request.url).pathname)?.[1]);
  const { templateCatalog } = await import('../template-cards.server');
  const { cards } = await templateCatalog();
  return Response.json(
    Object.fromEntries(
      cards
        .filter((card) => card.visuals === n && card.preview)
        .map((card) => [card.id, card.preview]),
    ),
  );
}
