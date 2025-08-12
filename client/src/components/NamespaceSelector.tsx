import { useState } from 'react';
import { useSSE } from '../hooks/useSSE';
import { Button } from '@/components/ui/button';

export function NamespaceSelector() {
	const { namespace, setNamespace, connectionStatus } = useSSE();
	const [inputValue, setInputValue] = useState(namespace);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (inputValue.trim()) {
			setNamespace(inputValue.trim());
		}
	}

	const predefinedNamespaces = ['bookmarks', 'notifications', 'chat', 'updates'];

	return (
		<div className="w-full max-w-2xl rounded-lg border bg-white p-4 shadow-sm dark:bg-neutral-900">
			<div className="flex items-center justify-between">
				<h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Select Namespace</h3>
				{namespace ? (
					<span
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
							connectionStatus === 'connected'
								? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
							: connectionStatus === 'connecting'
							? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
							: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
						}`}
					>
						<span className="size-1.5 rounded-full bg-current opacity-70" />
						{connectionStatus}
					</span>
				) : null}
			</div>

			{!namespace ? (
				<div className="mt-3 space-y-4">
					<p className="text-sm text-neutral-600 dark:text-neutral-400">
						Please select a namespace to connect to:
					</p>

					<form onSubmit={handleSubmit} className="space-y-2">
						<div className="flex flex-col gap-2 sm:flex-row">
							<label htmlFor="namespace" className="sr-only">
								Namespace
							</label>
							<input
								id="namespace"
								type="text"
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								placeholder="Enter namespace name..."
								required
								className="flex-1 rounded-md border bg-white px-3 py-2 text-sm shadow-xs outline-none ring-0 placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
							/>
							<Button type="submit" className="sm:self-start">
								Connect
							</Button>
						</div>
					</form>

					<div className="pt-1">
						<p className="mb-2 text-xs font-medium text-neutral-500">Or choose a predefined namespace:</p>
						<div className="flex flex-wrap gap-2">
							{predefinedNamespaces.map((ns) => (
								<Button
									key={ns}
									variant="outline"
									size="sm"
									onClick={() => {
										setInputValue(ns);
										setNamespace(ns);
									}}
								>
									{ns}
								</Button>
							))}
						</div>
					</div>
				</div>
			) : (
				<div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="text-sm text-neutral-700 dark:text-neutral-200">
							Connected to namespace: <strong className="font-semibold">{namespace}</strong>
						</p>
						<p className="text-xs text-neutral-500">
							Status is <span className="font-medium">{connectionStatus}</span>
						</p>
					</div>
					<Button
						variant="secondary"
						onClick={() => {
							setNamespace('');
							setInputValue('');
						}}
					>
						Change Namespace
					</Button>
				</div>
			)}
		</div>
	);
}
