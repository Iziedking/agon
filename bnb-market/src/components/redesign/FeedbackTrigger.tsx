export function FeedbackTrigger({ className = "" }: { className?: string }) {
  return (
    <a
      href="#"
      className={className}
      onClick={(event) => {
        event.preventDefault();
      }}
    >
      Feedback
    </a>
  );
}
