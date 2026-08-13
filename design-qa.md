# alphaScreen QA refresh design QA

## Visual truth

- Figma file: `XyJlaQda7mxfFoyIRNFgY6`
- Public site light: node `6:2`
- Client dashboard light: node `8:2`
- Admin dashboard light: node `9:2`
- Client dashboard dark: node `15:57`
- Comparison viewport: 1440 x 1024 CSS pixels at 1x density
- Implementation state: deterministic local fixtures rendered through the production overview components and shared refresh stylesheet; no authentication bypass was added to the application.

## Comparison method

Dashboard nodes were rendered at their natural 1440 x 1024 dimensions. The public node was rendered at 1440 x 1160. Each corresponding local implementation was captured at the same viewport in the in-app browser. Source and implementation pairs were assembled into side-by-side comparisons for full-frame inspection.

## Findings and corrections

1. Public page: passed after correction. The initial implementation exposed only the navigation and sign-in popover; the approved hero, candidate-workspace preview, membership section, and explicit input styling were added and rechecked.
2. Light client overview: passed. Header, sidebar, overview hierarchy, metric cards, action panel, pipeline card, candidate list, role list, spacing, and color relationships match the approved direction. Live QA data will replace the visual-QA fixtures through the existing dashboard loaders.
3. Light admin overview: passed. Platform navigation, client context, six-card summary, administrative workspace banner, client activity, and attention shortcuts match the approved direction while retaining the application's existing admin workflows.
4. Dark client overview: passed. The dark semantic tokens preserve contrast, hierarchy, borders, states, and the approved navy/lavender/cyan/mint palette. Dark mode follows the operating-system preference; the deterministic QA class is also supported for future controlled testing.
5. Scope correction: Figma-only dashboard navigation items that do not map to existing application routes were not invented. Existing alphaScreen navigation and behavior remain authoritative.
6. Temporary visual-QA preview route: removed before the final build. No development fixture route ships in QA.

## Interaction checks

- Overview action to Candidates updates the active navigation state: passed.
- Existing dashboard navigation handlers remain unchanged and are reused by overview shortcuts: passed by source inspection and local interaction.
- Authenticated routes remain protected: passed by source inspection; no bypass or fixture route remains.

## Final result

passed
