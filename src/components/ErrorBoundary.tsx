import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from 'i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/Button'

interface State {
  error: Error | null
}

/** Keeps a crash in one screen from taking down the till; the cart is persisted, so nothing is lost. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <AlertTriangle className="size-7" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{i18n.t('somethingWentWrong')}</h2>
          <p className="mt-1 max-w-md text-sm break-words text-muted">{this.state.error.message}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null })}>{i18n.t('tryAgain')}</Button>
          <Button variant="primary" onClick={() => location.reload()}>
            {i18n.t('reload')}
          </Button>
        </div>
      </div>
    )
  }
}
