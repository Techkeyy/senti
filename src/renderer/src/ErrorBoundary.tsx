import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Where the Back button goes. The boundary clears itself afterwards. */
  onBack: () => void
}

/** Shows a sentence and a Back button instead of a blank window when a screen throws while rendering. */
export default class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Senti screen failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="stack-lg" style={{ padding: 32 }}>
        <p role="alert">This playtest could not be displayed.</p>
        <div>
          <button
            className="btn"
            onClick={() => {
              this.setState({ failed: false })
              this.props.onBack()
            }}
          >
            Back
          </button>
        </div>
      </div>
    )
  }
}
