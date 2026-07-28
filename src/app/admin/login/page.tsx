import { PlatformLoginForm } from "../../_components/PlatformConsole";

export default function PlatformLoginPage() {
  return (
    <div className="wrap" style={{ maxWidth: 440, paddingBlock: "56px" }}>
      <h1 style={{ fontSize: "1.7rem", marginBottom: 8 }}>Platform console</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Cross-tenant administration for the operator of this deployment.
      </p>
      <PlatformLoginForm />
    </div>
  );
}
