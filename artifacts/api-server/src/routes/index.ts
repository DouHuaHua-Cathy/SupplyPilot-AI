import { Router, type IRouter } from "express";
import healthRouter from "./health";
import supplierAnalysisRouter from "./supplier-analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(supplierAnalysisRouter);

export default router;
