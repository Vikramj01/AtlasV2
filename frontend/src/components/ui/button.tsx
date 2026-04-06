import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary — navy fill, white text (design spec: "Primary: Navy fill, White text")
        default:     'bg-primary text-primary-foreground hover:bg-primary/90',
        // Secondary — white fill, navy border + text (design spec: "Secondary: White fill, Navy border")
        secondary:   'border border-primary bg-white text-primary hover:bg-primary/5',
        // Ghost — text only, accent-blue underline on hover (design spec: "Ghost: Text only, blue underline on hover")
        ghost:       'text-muted-foreground hover:text-[#2E75B6] hover:underline hover:decoration-[#2E75B6] bg-transparent',
        // Destructive — kept for delete/danger actions
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // Outline — subtle outlined variant (kept for internal use, e.g. icon buttons)
        outline:     'border border-input bg-background hover:bg-secondary hover:text-foreground',
        // Link — inline text link style
        link:        'text-[#2E75B6] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm:      'h-8 rounded-md px-3 text-xs',
        lg:      'h-11 rounded-md px-8',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size:    'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
