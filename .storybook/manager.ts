// The catalog is a dark-room tool like the editor it documents; the light manager
// chrome against near-black story canvases is a jarring pair.
import { addons } from 'storybook/manager-api'
import { themes } from 'storybook/theming'

addons.setConfig({ theme: themes.dark })
