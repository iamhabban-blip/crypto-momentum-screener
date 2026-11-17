"""Backtests: anyone signed in can read results; analysts and admins can queue new runs.
The worker executes queued runs so the API stays fast."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_current_user, require_role
from ..models import BacktestRun, Role, RunStatus, User
from ..schemas import BacktestIn, BacktestOut

router = APIRouter(prefix="/api/backtests", tags=["backtests"])


@router.get("", response_model=list[BacktestOut])
def list_runs(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(BacktestRun).order_by(BacktestRun.id.desc()).limit(20)).all()


@router.get("/{run_id}", response_model=BacktestOut)
def get_run(run_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    run = db.get(BacktestRun, run_id)
    if run is None:
        raise HTTPException(404, "Backtest not found.")
    return run


@router.post("", response_model=BacktestOut, status_code=202)
def queue_run(body: BacktestIn, request: Request, db: Session = Depends(get_db),
              user: User = Depends(require_role(Role.analyst))):
    busy = db.scalar(select(BacktestRun.id).where(BacktestRun.status.in_([RunStatus.queued, RunStatus.running])))
    if busy:
        raise HTTPException(409, "A backtest is already running. Try again when it finishes.")
    run = BacktestRun(created_by=user.id, status=RunStatus.queued, params=body.model_dump())
    db.add(run)
    db.flush()
    audit(db, request, "backtest_queued", user=user, target=str(run.id), **body.model_dump())
    db.commit()
    return run
