import { brand, type LogoVariant } from '../brand/brand'

interface Props {
  variant: LogoVariant
  /** Rendered width in px. The height follows the artwork's own proportions. */
  width: number
  className?: string
}

/**
 * The approved logo artwork. Both themes' files are rendered and CSS shows the one that matches
 * the current theme, so a theme switch needs no re-render.
 */
export default function Logo({ variant, width, className = '' }: Props) {
  const files = brand.logos[variant]
  const alt = variant === 'symbol' ? '' : brand.name
  return (
    <span className={`logo ${className}`} style={{ width }}>
      <img className="logo__img logo__img--light" src={files.light} alt={alt} width={width} />
      <img className="logo__img logo__img--dark" src={files.dark} alt="" aria-hidden width={width} />
    </span>
  )
}
