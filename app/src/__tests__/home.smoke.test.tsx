import { render, screen } from '@testing-library/react-native';
import Home from '@/app/index';

test('home renders the app name', async () => {
  await render(<Home />);
  expect(screen.getByText('RaGo Lens')).toBeTruthy();
});
