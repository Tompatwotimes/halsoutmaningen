import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/feedback/ErrorState';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // TODO(observability): forward to an error reporter once configured.
    console.error('Unhandled UI error', error, info);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="Appen kraschade"
          message="Ladda om sidan för att fortsätta."
          onRetry={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
