import { render, screen, fireEvent } from '@testing-library/react-native';
import { Slider, valueFromX } from '@/components/Slider';

describe('valueFromX', () => {
  it('maps a touch position to a stepped value within range', () => {
    expect(valueFromX(0, 200, 10, 110, 1)).toBe(10);
    expect(valueFromX(200, 200, 10, 110, 1)).toBe(110);
    expect(valueFromX(100, 200, 10, 110, 1)).toBe(60);
    expect(valueFromX(-50, 200, 10, 110, 1)).toBe(10);
    expect(valueFromX(999, 200, 10, 110, 1)).toBe(110);
    expect(valueFromX(103, 200, 0, 100, 10)).toBe(50);
    expect(valueFromX(5, 0, 3, 9, 1)).toBe(3);
  });
});

describe('Slider accessibility', () => {
  it('increments and decrements through accessibility actions, clamped', async () => {
    const onChange = jest.fn();
    await render(
      <Slider label="Brush size" value={5} min={1} max={6} step={1} onChange={onChange} />,
    );
    const el = screen.getByLabelText('Brush size');
    await fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(6);
    await fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(4);
  });
});
