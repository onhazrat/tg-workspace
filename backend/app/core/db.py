import logging

from sqlmodel import Session, create_engine, select

from app import crud
from app.core.config import settings
from app.core.permissions import ROLE_ADMIN, SEEDED_ROLES
from app.models import User, UserCreate
from app.models_rbac import Role, UserRole

logger = logging.getLogger(__name__)

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))


# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/fastapi/full-stack-fastapi-template/issues/28


def reconcile_seeded_roles(session: Session) -> None:
    """Bring the three seeded roles in line with `SEEDED_ROLES`.

    Migration `b0c1d2e3f4a5` inserts them so a freshly migrated database is
    correct before anything boots. This runs on every start, and exists because
    those two can drift: adding a permission to Admin is a code change, and
    without reconciliation the row in `rbac_roles` would still hold yesterday's
    list. Authorisation reads the row, so the code's claim would simply be
    false — the sort of divergence that shows up as "the flag is set but it does
    not work".

    Only the seeded ids are touched. A role an operator added is data they own,
    and this must never reach in and rewrite it — that is what makes "a fourth
    role is an insert rather than a migration" true rather than aspirational.
    """
    changed = False
    for seed in SEEDED_ROLES:
        permissions = [permission.value for permission in seed.permissions]
        role = session.get(Role, seed.id)
        if role is None:
            session.add(
                Role(
                    id=seed.id,
                    description=seed.description,
                    permissions=permissions,
                )
            )
            changed = True
        elif role.permissions != permissions or role.description != seed.description:
            role.permissions = permissions
            role.description = seed.description
            session.add(role)
            changed = True
    if changed:
        session.commit()
        logger.info("Reconciled seeded roles")


def init_db(session: Session) -> None:
    # Tables should be created with Alembic migrations
    # But if you don't want to use migrations, create
    # the tables un-commenting the next lines
    # from sqlmodel import SQLModel

    # This works because the models are already imported and registered from app.models
    # SQLModel.metadata.create_all(engine)

    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
        )
        user = crud.create_user(session=session, user_create=user_in)
        logger.info("Created bootstrap superuser %s", settings.FIRST_SUPERUSER)

    # Assigned here as well as in migration b0c1d2e3f4a5, because the two cover
    # different cases: the migration promotes superusers that already existed,
    # this covers a superuser bootstrapped into an empty database afterwards.
    # Authorisation reads roles only, so a bootstrap superuser without this row
    # would come up unable to manage anything.
    reconcile_seeded_roles(session)

    if not session.get(UserRole, (user.id, ROLE_ADMIN)):
        session.add(UserRole(user_id=user.id, role_id=ROLE_ADMIN))
        session.commit()
        logger.info("Granted %s the %s role", settings.FIRST_SUPERUSER, ROLE_ADMIN)
