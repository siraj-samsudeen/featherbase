// A stylesheet imported as text (`?inline`): Vite processes it (Tailwind
// included) and hands over the result as a string, for the bar's shadow root.
declare module '*.css?inline' {
  const css: string
  export default css
}
