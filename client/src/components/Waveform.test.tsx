import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Waveform } from './Waveform';

const peaks = Array.from({ length: 20 }, (_value, index) => 0.2 + (index % 5) * 0.15);

describe('Waveform', () => {
  it('renders one bar per peak and exposes slider semantics', () => {
    render(<Waveform peaks={peaks} progressMs={11_000} durationMs={22_000} />);
    const slider = screen.getByRole('slider', { name: 'Seek within track' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '22');
    expect(slider).toHaveAttribute('aria-valuenow', '11');
    expect(slider.querySelectorAll('span')).toHaveLength(peaks.length);
  });

  it('seeks proportionally when clicked', () => {
    const onSeek = vi.fn();
    render(<Waveform peaks={peaks} progressMs={0} durationMs={20_000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 40,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    });
    fireEvent.click(slider, { clientX: 50 });
    expect(onSeek).toHaveBeenCalledWith(5_000);
  });

  it('seeks with the keyboard', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<Waveform peaks={peaks} progressMs={10_000} durationMs={22_000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSeek).toHaveBeenLastCalledWith(15_000);
    await user.keyboard('{ArrowLeft}');
    expect(onSeek).toHaveBeenLastCalledWith(5_000);
  });

  it('clamps seeking at both ends', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<Waveform peaks={peaks} progressMs={1_000} durationMs={22_000} onSeek={onSeek} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('is inert when not interactive', () => {
    render(<Waveform peaks={peaks} progressMs={0} durationMs={22_000} interactive={false} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('falls back to placeholder bars when a track has no peaks', () => {
    render(<Waveform peaks={[]} progressMs={0} durationMs={22_000} />);
    expect(screen.getByTestId('waveform').querySelectorAll('span').length).toBeGreaterThan(10);
  });
});
