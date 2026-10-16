import { Component, type ReactNode } from 'react';

/** Bir karakter modeli yüklenemezse sahnenin tamamı çökmesin: yerine yedeği göster */
export class SafeBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('karakter yüklenemedi, yedek kullanılıyor:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
