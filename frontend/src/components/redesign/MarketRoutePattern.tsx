/**
 * A quiet route map for the AGON market canvas.
 *
 * The lines suggest services moving through a marketplace without turning the
 * page into a generic "AI network" illustration. It stays decorative and
 * never carries product state or interaction.
 */
export function MarketRoutePattern() {
  return (
    <svg
      aria-hidden="true"
      className="agon-route-pattern pointer-events-none absolute inset-0 z-0 h-full w-full"
      viewBox="0 0 1200 760"
      preserveAspectRatio="none"
      focusable="false"
    >
      <g fill="none" stroke="var(--route-line)" strokeWidth="1" vectorEffect="non-scaling-stroke">
        <path d="M0 166H132V82H286V228H442V128H624V252H788V104H968V196H1200" />
        <path d="M0 372H184V306H352V418H516V334H704V446H886V358H1200" />
        <path d="M0 566H116V654H278V492H430V606H604V466H782V584H958V452H1100V646H1200" />
        <path d="M132 0V82M286 82V228M442 128V252M624 0V128M788 104V252M968 0V196M1100 452V646" />
      </g>

      <g fill="var(--route-node)">
        <rect x="128" y="78" width="8" height="8" />
        <rect x="282" y="224" width="8" height="8" />
        <rect x="438" y="124" width="8" height="8" />
        <rect x="620" y="248" width="8" height="8" />
        <rect x="784" y="100" width="8" height="8" />
        <rect x="964" y="192" width="8" height="8" />
        <rect x="180" y="302" width="8" height="8" />
        <rect x="348" y="414" width="8" height="8" />
        <rect x="512" y="330" width="8" height="8" />
        <rect x="700" y="442" width="8" height="8" />
        <rect x="882" y="354" width="8" height="8" />
        <rect x="112" y="650" width="8" height="8" />
        <rect x="274" y="488" width="8" height="8" />
        <rect x="426" y="602" width="8" height="8" />
        <rect x="600" y="462" width="8" height="8" />
        <rect x="778" y="580" width="8" height="8" />
        <rect x="954" y="448" width="8" height="8" />
        <rect x="1096" y="642" width="8" height="8" />
      </g>

      <g fill="var(--accent)" opacity="0.62">
        <rect x="278" y="224" width="8" height="8" />
        <rect x="696" y="442" width="8" height="8" />
        <rect x="950" y="448" width="8" height="8" />
      </g>
    </svg>
  );
}
