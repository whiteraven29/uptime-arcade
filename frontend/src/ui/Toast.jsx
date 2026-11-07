export function Toast({ text }) {
  return <div className="toast" role="status" hidden={!text}>{text}</div>;
}
