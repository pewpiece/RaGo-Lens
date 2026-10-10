import { render } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import { unlabelledInteractives } from '@/testing/a11y';

describe('a11y helper (negative control: it really finds unnamed controls)', () => {
  it('flags an icon-only button without a label, accepts labelled or text buttons', async () => {
    await render(
      <View>
        <Pressable accessibilityRole="button" testID="bad">
          <View />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" />
        <Pressable accessibilityRole="radio">
          <Text>Square</Text>
        </Pressable>
      </View>,
    );
    expect(unlabelledInteractives()).toEqual(['button#bad']);
  });
});
