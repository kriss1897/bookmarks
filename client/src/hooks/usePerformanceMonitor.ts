import { useEffect, useRef } from 'react'

/**
 * Hook for monitoring component performance
 * Useful for identifying slow-rendering components
 */
export function usePerformanceMonitor(componentName: string, threshold = 16) {
	const startTime = useRef<number>(0)
	
	useEffect(() => {
		startTime.current = performance.now()
		
		return () => {
			const endTime = performance.now()
			const duration = endTime - startTime.current
			
			if (duration > threshold) {
				console.warn(
					`Performance warning: ${componentName} took ${duration.toFixed(2)}ms to render (threshold: ${threshold}ms)`
				)
			}
			
			// In production, send to monitoring service
			if (process.env.NODE_ENV === 'production' && duration > threshold) {
				// Example: sendToMonitoringService({ componentName, duration })
			}
		}
	})
}

/**
 * Hook for measuring and logging render times
 */
export function useRenderTime(componentName: string) {
	const renderCount = useRef(0)
	const totalTime = useRef(0)
	
	useEffect(() => {
		const startTime = performance.now()
		renderCount.current += 1
		
		return () => {
			const endTime = performance.now()
			const duration = endTime - startTime
			totalTime.current += duration
			
			if (renderCount.current % 10 === 0) {
				const averageTime = totalTime.current / renderCount.current
				console.log(
					`${componentName} - Renders: ${renderCount.current}, Average: ${averageTime.toFixed(2)}ms`
				)
			}
		}
	})
}
