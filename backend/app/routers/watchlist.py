"""Per-user watchlist. Users can only ever see or change their own rows."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_current_user
from ..models import Signal, Symbol, User, WatchlistItem
from ..schemas import WatchlistIn, WatchlistOut
from .signals import latest_run

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])
MAX_ITEMS = 50


@router.get("", response_model=list[WatchlistOut])
def list_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = db.scalars(select(WatchlistItem).where(WatchlistItem.user_id == user.id)
                       .order_by(WatchlistItem.created_at.desc())).all()
    run = latest_run(db)
    latest = {}
    if run:
        latest = {s.symbol: s for s in db.scalars(select(Signal).where(
            Signal.scan_run_id == run.id, Signal.symbol.in_([i.symbol for i in items])))}
    out = []
    for i in items:
        s = latest.get(i.symbol)
        out.append(WatchlistOut(symbol=i.symbol, note=i.note, created_at=i.created_at,
                                score=s.score if s else None, close=s.close if s else None,
                                ret_1d=s.ret_1d if s else None))
    return out


@router.post("", response_model=WatchlistOut, status_code=201)
def add_item(body: WatchlistIn, request: Request, db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    if db.get(Symbol, body.symbol) is None:
        raise HTTPException(404, "Unknown coin.")
    count = db.scalar(select(func.count()).select_from(WatchlistItem).where(WatchlistItem.user_id == user.id))
    if count >= MAX_ITEMS:
        raise HTTPException(409, f"Watchlist is limited to {MAX_ITEMS} coins.")
    item = db.get(WatchlistItem, (user.id, body.symbol))
    if item is None:
        item = WatchlistItem(user_id=user.id, symbol=body.symbol, note=body.note)
        db.add(item)
    else:
        item.note = body.note
    audit(db, request, "watchlist_add", user=user, target=body.symbol)
    db.commit()
    return WatchlistOut(symbol=item.symbol, note=item.note, created_at=item.created_at)


@router.delete("/{symbol}", status_code=204)
def remove_item(symbol: str, request: Request, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    item = db.get(WatchlistItem, (user.id, symbol.upper()))
    if item is None:
        raise HTTPException(404, "Not on your watchlist.")
    db.delete(item)
    audit(db, request, "watchlist_remove", user=user, target=symbol.upper())
    db.commit()
