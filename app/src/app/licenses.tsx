import { Text, View } from 'react-native';
import { Body, Header, Muted, Screen, SectionTitle } from '@/components/ui';
import { APACHE_2_TEXT } from '@/about/apache2';
import { MODEL_INFO, OTHER_LICENCES } from '@/about/licenses';
import { fonts, fontSizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export default function Licenses() {
  const { tokens: t } = useTheme();
  return (
    <Screen scroll header={<Header title="Licences" />}>
      <SectionTitle>Segmentation model</SectionTitle>
      <Body>{MODEL_INFO.name}</Body>
      <Muted>{MODEL_INFO.attribution}</Muted>
      <View style={{ height: spacing.md }} />
      <Text
        selectable
        style={{ color: t.text, fontFamily: fonts.mono, fontSize: fontSizes.caption }}
      >
        {APACHE_2_TEXT}
      </Text>
      <SectionTitle>Open-source libraries</SectionTitle>
      <Muted>{OTHER_LICENCES}</Muted>
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
