import { Link, useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ProofVerificationPanel from '../../components/ProofVerificationPanel';

export default function ProofVerifyPage() {
  const { id } = useParams();
  return (
    <div>
      <PageHeader
        title="Verify Proofs"
        breadcrumbs={[{ label: 'Home' }, { label: 'Department Reports' }, { label: 'Verify Proofs' }]}
      />
      <Link to="/reports/department" className="inline-block mb-4 text-sm text-primary-700 hover:underline">
        ← Back to Department Reports
      </Link>
      <ProofVerificationPanel submissionId={id!} />
    </div>
  );
}
