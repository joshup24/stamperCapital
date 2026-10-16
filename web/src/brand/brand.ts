// Brand content that is not CSS: name, tagline and logo files. To change the logo, replace the
// files in brand/assets/images/ (keep the names) or point the imports below at new ones.
// Logo rules (guidelines pp.16-20): never redraw, recolor, stretch or crop a logo; use light
// artwork on light surfaces and dark artwork on dark ones; keep clear space of 20% of the symbol.
import horizontalLight from './assets/images/yield-horizontal-light.png'
import horizontalDark from './assets/images/yield-horizontal-dark.png'
import stackedLight from './assets/images/yield-stacked-light.png'
import stackedDark from './assets/images/yield-stacked-dark.png'
import symbol from './assets/images/yield-symbol.png'

export const brand = {
  /** Spelled as in the guidelines. */
  name: 'YieldEndeavor',
  /** The product line in the approved horizontal lockup. */
  tagline: 'Invest in a brighter tomorrow',
  logos: {
    horizontal: { light: horizontalLight, dark: horizontalDark },
    stacked: { light: stackedLight, dark: stackedDark },
    /** The symbol artwork has no text, so one file serves both themes. */
    symbol: { light: symbol, dark: symbol },
  },
}

export type LogoVariant = keyof typeof brand.logos
