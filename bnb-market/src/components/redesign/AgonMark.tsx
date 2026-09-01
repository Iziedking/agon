import { ProductMark } from "./ProductMark";

interface Props {
  size?: number;
  className?: string;
  showWordmark?: boolean;
}

export function AgonMark({ size = 28, className = "", showWordmark = true }: Props) {
  return <ProductMark name="Agon" size={size} className={className} showWordmark={showWordmark} />;
}

