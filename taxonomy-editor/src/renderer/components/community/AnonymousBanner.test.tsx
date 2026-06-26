import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnonymousBanner } from './AnonymousBanner';

const mockUseAuthStatus = vi.fn();
vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => mockUseAuthStatus(),
}));

describe('AnonymousBanner', () => {
  beforeEach(() => {
    mockUseAuthStatus.mockReset();
  });

  it('renders nothing when auth is null', () => {
    mockUseAuthStatus.mockReturnValue(null);
    const { container } = render(<AnonymousBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when user is not anonymous', () => {
    mockUseAuthStatus.mockReturnValue({ user: 'alice', anonymous: false, idp: 'github' });
    const { container } = render(<AnonymousBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the banner when user is anonymous', () => {
    mockUseAuthStatus.mockReturnValue({ user: 'anon-123', anonymous: true, idp: 'anonymous' });
    render(<AnonymousBanner />);
    expect(screen.getByText(/Anonymous mode/)).toBeDefined();
    expect(screen.getByText(/your data is temporary/)).toBeDefined();
  });

  it('shows GitHub and Google sign-in links', () => {
    mockUseAuthStatus.mockReturnValue({ user: 'anon-123', anonymous: true, idp: 'anonymous' });
    render(<AnonymousBanner />);
    const githubLink = screen.getByText('Sign in with GitHub');
    const googleLink = screen.getByText('Sign in with Google');
    expect(githubLink.getAttribute('href')).toBe('/api/auth/fresh-login/github');
    expect(googleLink.getAttribute('href')).toBe('/api/auth/fresh-login/google');
  });
});
