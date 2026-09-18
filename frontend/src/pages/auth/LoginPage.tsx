import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';
import { GraduationCap, Eye, EyeOff } from 'lucide-react';

const schema = z.object({
  employeeCode: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
});

type FormData = z.infer<typeof schema>;

// Where each role starts. Roles stack (the bootstrap account is ADMIN +
// PRINCIPAL), so the first match in this order wins — widest remit first, with
// the maintenance admin last because it owns no appraisal content.
const LANDING: [role: string, path: string][] = [
  ['PRINCIPAL', '/principal/reports'],
  ['DEAN', '/dean/appraisals'],
  ['SPECIAL_SCRUTINIZER', '/final-review'],
  ['SCRUTINIZER', '/final-review'],
  ['HOD', '/reviews'],
  ['REVIEWER', '/reviews'],
  ['ADMIN', '/admin/dashboard'],
];

const landingFor = (roles: { role: string }[]) =>
  LANDING.find(([role]) => roles.some((r) => r.role === role))?.[1] ?? '/dashboard';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await authApi.login(data.employeeCode, data.password);
      login(res.accessToken, res.user);
      navigate(landingFor(res.user.roles));
    } catch {
      toast.error('Invalid credentials');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left pane — institute hero */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 text-white flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-accent-500/10" />
        <div className="absolute -bottom-32 -right-16 w-80 h-80 rounded-full bg-accent-500/5" />

        <div className="relative z-10 text-center max-w-md">
          {/* Institute logo (on a light card so the black wordmark reads on the dark hero) */}
          <div className="bg-white rounded-xl shadow-lg px-6 py-5 mb-8 inline-block">
            <img
              src="/vnrvjiet-logo.png"
              alt="VNRVJIET — Vallurupalli Nageswara Rao Vignana Jyothi Institute of Engineering & Technology"
              className="h-20 w-auto mx-auto"
            />
          </div>

          <div className="flex items-center justify-center gap-3 mb-8">
            <span className="px-3 py-1 rounded text-[11px] font-semibold bg-accent-500/20 text-accent-300 border border-accent-500/30">
              NAAC A++
            </span>
            <span className="px-3 py-1 rounded text-[11px] font-semibold bg-accent-500/20 text-accent-300 border border-accent-500/30">
              NBA Accredited
            </span>
            <span className="px-3 py-1 rounded text-[11px] font-semibold bg-accent-500/20 text-accent-300 border border-accent-500/30">
              Autonomous
            </span>
          </div>

          <p className="text-xs text-primary-300 italic font-serif">
            TAMASOMA JYOTIRGAMAYA
          </p>
          <p className="text-[10px] text-primary-400 mt-1">
            "Lead me from darkness to light"
          </p>
        </div>
      </div>

      {/* Right pane — sign-in form */}
      <div className="flex-1 flex items-center justify-center bg-surface-base p-6">
        <div className="w-full max-w-sm">
          {/* Mobile-only branding */}
          <div className="lg:hidden text-center mb-8">
            <img src="/vnrvjiet-logo.png" alt="VNRVJIET" className="h-12 w-auto mx-auto mb-3" />
            <div className="text-xs text-ink-muted">Faculty Appraisal Portal</div>
          </div>

          <div className="bg-surface-card border border-surface-border rounded-md shadow-sm overflow-hidden">
            {/* Gold top accent */}
            <div className="h-1 bg-accent-500" />

            <div className="p-6">
              <div className="flex items-center gap-2 mb-1">
                <GraduationCap size={20} className="text-primary-600" />
                <h2 className="text-lg font-bold text-ink-primary">Faculty Portal</h2>
              </div>
              <p className="text-xs text-ink-muted mb-5">Sign in with your employee credentials</p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-secondary mb-1">Employee Code</label>
                  <input
                    {...register('employeeCode')}
                    className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="e.g. FAC001"
                  />
                  {errors.employeeCode && <p className="text-danger-500 text-xs mt-1">{errors.employeeCode.message}</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink-secondary mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      {...register('password')}
                      className="w-full border border-surface-border rounded px-3 py-2 pr-10 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-primary"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {errors.password && <p className="text-danger-500 text-xs mt-1">{errors.password.message}</p>}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded text-sm transition-colors"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                </button>

                <div className="text-center">
                  <Link to="/forgot-password" className="text-xs text-primary-600 hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </form>
            </div>
          </div>

          <p className="text-center text-[10px] text-ink-subtle mt-4">
            &copy; {new Date().getFullYear()} VNRVJIET — Faculty Appraisal System
          </p>
        </div>
      </div>
    </div>
  );
}
