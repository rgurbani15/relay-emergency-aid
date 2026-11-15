import { Link } from "react-router-dom";
import { Button, EmptyState } from "@/components/ui";
export default function NotFound({ inApp }: { inApp?: boolean }) {
  return (
    <div className={inApp ? "" : "grid min-h-dvh place-items-center p-6"}>
      <EmptyState title="Page not found" message="That page doesn't exist or has moved." action={<Link to={inApp ? "/app/overview" : "/"}><Button>Go {inApp ? "to overview" : "home"}</Button></Link>} />
    </div>
  );
}
