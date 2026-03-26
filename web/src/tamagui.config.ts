import { createTamagui } from 'tamagui';
import { defaultConfig } from '@tamagui/config/v5';

const tamaguiConfig = createTamagui(defaultConfig);

type AppConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default tamaguiConfig;
