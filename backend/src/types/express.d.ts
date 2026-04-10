declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        email: string;
        plan: 'free' | 'pro' | 'agency';
        /** True for accounts in SUPER_ADMIN_EMAILS — bypasses all plan gates. */
        isSuperAdmin: boolean;
      };
    }
  }
}

export {};
