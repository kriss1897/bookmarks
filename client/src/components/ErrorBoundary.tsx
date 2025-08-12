import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
	children: ReactNode
}

interface State {
	hasError: boolean
	error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
	public state: State = {
		hasError: false
	}

	public static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error }
	}

	public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error('Uncaught error:', error, errorInfo)
		// In production, log to external service (e.g., Sentry)
	}

	public render() {
		if (this.state.hasError) {
			return (
				<div className="min-h-screen flex items-center justify-center bg-gray-50">
					<div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
						<div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full">
							<svg
								className="w-6 h-6 text-red-600"
								fill="none"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
							</svg>
						</div>
						<div className="mt-4 text-center">
							<h3 className="text-lg font-medium text-gray-900">
								Something went wrong
							</h3>
							<p className="mt-2 text-sm text-gray-600">
								We encountered an unexpected error. Please refresh the page and try again.
							</p>
							<div className="mt-6">
								<button
									type="button"
									className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
									onClick={() => window.location.reload()}
								>
									Refresh Page
								</button>
							</div>
						</div>
					</div>
				</div>
			)
		}

		return this.props.children
	}
}
