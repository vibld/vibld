# Examples

Projects vibld generated, kept exactly as it wrote them, and shown on
[vibld.com/examples](https://vibld.com/examples).

- `catalogue.json` lists each one: the eval case it came from
  (`packages/eval/src/cases.ts`), the prompt that case sends, the model, and
  the GitHub Actions run that generated it. The page, the publish workflow
  and `packages/eval/test/examples-catalogue.test.ts` all read it.
- `generated/<slug>/` is each project's source, unedited. They sit one level
  down so the `examples/*` workspace glob does not turn them into monorepo
  packages: each one installs on its own, with npm, the way an export does.

## Adding one

1. Generate it with the **Model bakeoff** workflow (one model, one case, one
   run) and download the `bakeoff-candidates` artifact.
2. Copy `<model>/<case>/` to `generated/<slug>/` without changing a file.
3. Add its entry to `catalogue.json`.
4. Open the pull request, which runs the **Example screenshots** workflow
   (or run it by hand from the branch), and copy
   `<slug>.webp` from its `example-screenshots` artifact to
   `apps/marketing/public/examples/`. It builds each example the way
   **Publish examples** does, in its own container with no secret in reach,
   and screenshots the first screen at 1440x900.
5. Run the **Publish examples** workflow once the change is on `main`.

An example that does not build, or builds and throws when it loads, is
regenerated or left out. It is never patched until it works: the page promises that what it shows is what vibld
made.
