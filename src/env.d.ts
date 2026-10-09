declare namespace App {
    interface Locals {
        user: import('./auth').Auth['$Infer']['Session']['user'] | null;
    }
}
