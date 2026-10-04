import { useId, useImperativeHandle, useRef, type CSSProperties, type Ref } from "react";
import { WIZARD_PARTS, WIZARD_TIP, WIZARD_VIEWBOX, type WizardPart } from "./rig";

/** DOM handles for animating the rig. Every group rotates around its own joint. */
export interface WizardHandle {
  el: HTMLDivElement;
  root: SVGGElement;
  cape: SVGGElement;
  bristles: SVGGElement;
  head: SVGGElement;
  arm: SVGGElement;
  hand: SVGGElement;
  tip: SVGCircleElement;
}

interface WizardProps {
  size: number;
  /** Cape and hair ripple in the wind. Off for the static mark. */
  flutter?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<WizardHandle>;
  title?: string;
}

const origin = (part: WizardPart): CSSProperties => {
  const [x, y] = WIZARD_PARTS[part].pivot;
  return { transformOrigin: `${x}px ${y}px`, transformBox: "view-box" };
};

/** The TidyFlow wizard, drawn in the current text colour. */
export function Wizard({ size, flutter = false, className = "", style, ref, title }: WizardProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const el = useRef<HTMLDivElement>(null);
  const parts = useRef<Partial<Record<string, SVGGElement | SVGCircleElement | null>>>({});
  const set = (name: string) => (node: SVGGElement | SVGCircleElement | null) => {
    parts.current[name] = node;
  };

  useImperativeHandle(ref, () => {
    const p = parts.current;
    return {
      el: el.current!,
      root: p.root as SVGGElement,
      cape: p.cape as SVGGElement,
      bristles: p.bristles as SVGGElement,
      head: p.head as SVGGElement,
      arm: p.arm as SVGGElement,
      hand: p.hand as SVGGElement,
      tip: p.tip as SVGCircleElement,
    };
  }, []);

  const path = (part: WizardPart) => <path d={WIZARD_PARTS[part].d} />;

  return (
    <div
      ref={el}
      className={className}
      style={{ width: size, height: size, ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <svg viewBox={WIZARD_VIEWBOX} width="100%" height="100%" fill="currentColor" style={{ overflow: "visible", display: "block" }}>
        {flutter && (
          <defs>
            <filter id={`cape${id}`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.007 0.016" numOctaves={1} seed={4}>
                <animate attributeName="baseFrequency" dur="2.4s" values="0.007 0.016;0.009 0.019;0.007 0.016" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" scale={13} xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id={`hair${id}`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.022" numOctaves={1} seed={9}>
                <animate attributeName="baseFrequency" dur="1.8s" values="0.012 0.022;0.015 0.026;0.012 0.022" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" scale={6} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        )}
        <g ref={set("root")} style={{ transformOrigin: "560px 520px", transformBox: "view-box" }}>
          <g ref={set("cape")} style={origin("cape")} filter={flutter ? `url(#cape${id})` : undefined}>
            {path("cape")}
          </g>
          <g ref={set("bristles")} style={origin("bristles")}>
            {path("bristles")}
          </g>
          {path("body")}
          <g ref={set("head")} style={origin("head")} filter={flutter ? `url(#hair${id})` : undefined}>
            {path("head")}
          </g>
          <g ref={set("arm")} style={origin("wandArm")}>
            {path("wandArm")}
            <g ref={set("hand")} style={origin("hand")}>
              {path("hand")}
              <circle ref={set("tip")} cx={WIZARD_TIP[0]} cy={WIZARD_TIP[1]} r={1} fill="none" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
