import { ProductMark } from "./ProductMark";

interface Props {
  size?: number;
  className?: string;
  /// Render the wordmark next to the mark. Defaults to true.
  showWordmark?: boolean;
}

export function ArcRunMark({ size = 28, className = "", showWordmark = true }: Props) {
  return <ProductMark name="ArcRun" size={size} className={className} showWordmark={showWordmark} />;
}
