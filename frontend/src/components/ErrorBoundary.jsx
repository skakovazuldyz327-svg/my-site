import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prevProps, prevState) {
    // Only an error that was already on screen is reset: the update that caused it may carry a new key too.
    if (prevState.failed && this.state.failed && prevProps.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}
