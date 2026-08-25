"""Role-isolated application, scheduling, clinical, reminder, and integration routes."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import ActorContext, require_role
from ..config import get_settings
from ..db import get_session
from ..domain import DomainService
from ..domain_schemas import (
    AppointmentCancelRequest,
    AppointmentDetailResponse,
    AppointmentListResponse,
    AppointmentRescheduleRequest,
    AppointmentSummaryResponse,
    DoctorCreateRequest,
    DoctorListResponse,
    DoctorSummaryResponse,
    DoctorUpdateRequest,
    IntegrationListResponse,
    IntegrationRetryRequest,
    IntegrationStatusResponse,
    LeaveApplyRequest,
    LeaveEditRequest,
    LeaveImpactResponse,
    LeaveListResponse,
    LeavePreviewRequest,
    LeaveResponse,
    PatientProfileResponse,
    PatientVisitResponse,
    ProfileUpdateRequest,
    ReminderPreferencesRequest,
    ReminderPreferencesResponse,
    ReminderScheduleResponse,
    SymptomIntakeRequest,
    SymptomsResponse,
    SymptomVersionResponse,
    UserContextResponse,
    VisitAmendmentRequest,
    VisitCompleteRequest,
    VisitResponse,
    VisitUpdateRequest,
    WorkingHoursReplaceRequest,
    WorkingHoursResponse,
)
from ..errors import ApiError
from ..schemas import COMMON_ERROR_RESPONSES

router = APIRouter(tags=["application-domain"], responses=COMMON_ERROR_RESPONSES)
IdempotencyKey = Annotated[
    str,
    Header(
        ...,
        alias="Idempotency-Key",
        min_length=16,
        max_length=128,
        pattern=r"^[\x21-\x7e]+$",
        description="Opaque retry key for this mutation (16-128 visible ASCII characters).",
    ),
]


def _request_id(request: Request) -> str:
    return str(request.scope.get("healthcare_request_id", "unknown"))


def _service(session: AsyncSession, request: Request) -> DomainService:
    return DomainService(session, get_settings(), _request_id(request))


def _doctor_owner(actor: ActorContext, doctor_id: UUID) -> None:
    if actor.role == "doctor" and actor.doctor_id != str(doctor_id):
        raise ApiError(403, "FORBIDDEN", "Access is forbidden.")


@router.get("/me", response_model=UserContextResponse, operation_id="getMe")
async def get_me(
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
) -> UserContextResponse:
    # The context is derived from the verified actor dependency; no token claims are echoed.
    return UserContextResponse.model_validate(
        {
            "subject_id": actor.subject_id,
            "role": actor.role,
            "available_roles": [actor.role],
            "profile_id": actor.patient_id or actor.doctor_id,
        }
    )


@router.get("/me/profile", response_model=PatientProfileResponse, operation_id="getMyProfile")
async def get_my_profile(
    request: Request,
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> PatientProfileResponse:
    return PatientProfileResponse.model_validate(
        await _service(session, request).get_profile(actor)
    )


@router.patch("/me/profile", response_model=PatientProfileResponse, operation_id="updateMyProfile")
async def update_my_profile(
    payload: ProfileUpdateRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> PatientProfileResponse:
    return PatientProfileResponse.model_validate(
        await _service(session, request).update_profile(actor, payload)
    )


@router.get("/doctors", response_model=DoctorListResponse, operation_id="searchDoctors")
async def search_doctors(
    search: str | None = Query(default=None, max_length=120),
    active_only: bool = Query(default=True),
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> DoctorListResponse:
    return DoctorListResponse(
        items=[
            DoctorSummaryResponse.model_validate(item)
            for item in await DomainService(session, get_settings()).list_doctors(
                search=search, active_only=active_only
            )
        ]
    )


@router.get("/doctors/{doctor_id}", response_model=DoctorSummaryResponse, operation_id="getDoctor")
async def get_doctor(
    doctor_id: UUID,
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> DoctorSummaryResponse:
    return DoctorSummaryResponse.model_validate(
        await DomainService(session, get_settings()).get_doctor(
            doctor_id, include_inactive=actor.role == "admin"
        )
    )


@router.post(
    "/doctors",
    response_model=DoctorSummaryResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="createDoctor",
)
async def create_doctor(
    payload: DoctorCreateRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> DoctorSummaryResponse:
    return DoctorSummaryResponse.model_validate(
        await _service(session, request).create_doctor(actor, payload, idempotency_key)
    )


@router.patch(
    "/doctors/{doctor_id}", response_model=DoctorSummaryResponse, operation_id="updateDoctor"
)
async def update_doctor(
    doctor_id: UUID,
    payload: DoctorUpdateRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> DoctorSummaryResponse:
    return DoctorSummaryResponse.model_validate(
        await _service(session, request).update_doctor(actor, doctor_id, payload)
    )


@router.get(
    "/doctors/{doctor_id}/working-hours",
    response_model=WorkingHoursResponse,
    operation_id="getDoctorWorkingHours",
)
async def get_working_hours(
    doctor_id: UUID,
    actor: ActorContext = Depends(require_role("doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> WorkingHoursResponse:
    _doctor_owner(actor, doctor_id)
    return WorkingHoursResponse.model_validate(
        await DomainService(session, get_settings()).get_working_hours(doctor_id)
    )


@router.put(
    "/doctors/{doctor_id}/working-hours",
    response_model=WorkingHoursResponse,
    operation_id="replaceDoctorWorkingHours",
)
async def replace_working_hours(
    doctor_id: UUID,
    payload: WorkingHoursReplaceRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> WorkingHoursResponse:
    _doctor_owner(actor, doctor_id)
    return WorkingHoursResponse.model_validate(
        await _service(session, request).replace_working_hours(actor, doctor_id, payload)
    )


@router.get(
    "/doctors/{doctor_id}/leave",
    response_model=LeaveListResponse,
    operation_id="listDoctorLeave",
)
async def list_leave(
    doctor_id: UUID,
    actor: ActorContext = Depends(require_role("doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> LeaveListResponse:
    _doctor_owner(actor, doctor_id)
    return LeaveListResponse(
        items=[
            LeaveResponse.model_validate(item)
            for item in await DomainService(session, get_settings()).list_leaves(doctor_id)
        ],
        next_cursor=None,
    )


@router.post(
    "/doctors/{doctor_id}/leave/preview",
    response_model=LeaveImpactResponse,
    operation_id="previewDoctorLeave",
)
async def preview_leave(
    doctor_id: UUID,
    payload: LeavePreviewRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> LeaveImpactResponse:
    return LeaveImpactResponse.model_validate(
        await _service(session, request).leave_preview(actor, doctor_id, payload)
    )


@router.post(
    "/doctors/{doctor_id}/leave",
    response_model=LeaveResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="applyDoctorLeave",
)
async def apply_leave(
    doctor_id: UUID,
    payload: LeaveApplyRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> LeaveResponse:
    return LeaveResponse.model_validate(
        await _service(session, request).apply_leave(actor, doctor_id, payload, idempotency_key)
    )


@router.post(
    "/doctors/{doctor_id}/leave/{leave_id}/preview",
    response_model=LeaveImpactResponse,
    operation_id="previewDoctorLeaveEdit",
)
async def preview_leave_edit(
    doctor_id: UUID,
    leave_id: UUID,
    payload: LeavePreviewRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> LeaveImpactResponse:
    # Recompute impact from current rows; the leave ID stays in the route for audit UX.
    _ = leave_id
    return LeaveImpactResponse.model_validate(
        await _service(session, request).leave_preview(actor, doctor_id, payload)
    )


@router.patch(
    "/doctors/{doctor_id}/leave/{leave_id}",
    response_model=LeaveResponse,
    operation_id="updateDoctorLeave",
)
async def update_leave(
    doctor_id: UUID,
    leave_id: UUID,
    payload: LeaveEditRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> LeaveResponse:
    return LeaveResponse.model_validate(
        await _service(session, request).edit_leave(
            actor, doctor_id, leave_id, payload, idempotency_key
        )
    )


@router.delete(
    "/doctors/{doctor_id}/leave/{leave_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteDoctorLeave",
)
async def delete_leave(
    doctor_id: UUID,
    leave_id: UUID,
    payload: LeaveApplyRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> None:
    await _service(session, request).delete_leave(
        actor, doctor_id, leave_id, payload, idempotency_key
    )


@router.get(
    "/appointments", response_model=AppointmentListResponse, operation_id="listAppointments"
)
async def list_appointments(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status", max_length=40),
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> AppointmentListResponse:
    return AppointmentListResponse(
        items=[
            AppointmentSummaryResponse.model_validate(item)
            for item in await _service(session, request).list_appointments(
                actor, status=status_filter, from_at=from_, to_at=to
            )
        ]
    )


@router.get(
    "/appointments/{appointment_id}",
    response_model=AppointmentDetailResponse,
    operation_id="getAppointment",
)
async def get_appointment(
    appointment_id: UUID,
    request: Request,
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> AppointmentDetailResponse:
    return AppointmentDetailResponse.model_validate(
        await _service(session, request).appointment_detail(actor, appointment_id)
    )


@router.post(
    "/appointments/{appointment_id}/cancel",
    response_model=AppointmentSummaryResponse,
    operation_id="cancelAppointment",
)
async def cancel_appointment(
    appointment_id: UUID,
    payload: AppointmentCancelRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> AppointmentSummaryResponse:
    return AppointmentSummaryResponse.model_validate(
        await _service(session, request).cancel_appointment(
            actor, appointment_id, payload, idempotency_key
        )
    )


@router.post(
    "/appointments/{appointment_id}/reschedule",
    response_model=AppointmentSummaryResponse,
    operation_id="rescheduleAppointment",
)
async def reschedule_appointment(
    appointment_id: UUID,
    payload: AppointmentRescheduleRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> AppointmentSummaryResponse:
    return AppointmentSummaryResponse.model_validate(
        await _service(session, request).reschedule_appointment(
            actor, appointment_id, payload, idempotency_key
        )
    )


@router.get(
    "/appointments/{appointment_id}/symptoms",
    response_model=SymptomsResponse,
    operation_id="getAppointmentSymptoms",
)
async def get_symptoms(
    appointment_id: UUID,
    request: Request,
    actor: ActorContext = Depends(require_role("patient", "doctor")),
    session: AsyncSession = Depends(get_session),
) -> SymptomsResponse:
    return SymptomsResponse.model_validate(
        await _service(session, request).get_symptoms(actor, appointment_id)
    )


@router.post(
    "/appointments/{appointment_id}/symptoms",
    response_model=SymptomVersionResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="addAppointmentSymptoms",
)
async def add_symptoms(
    appointment_id: UUID,
    payload: SymptomIntakeRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> SymptomVersionResponse:
    return SymptomVersionResponse.model_validate(
        await _service(session, request).add_symptoms(actor, appointment_id, payload)
    )


@router.get(
    "/appointments/{appointment_id}/visit",
    response_model=VisitResponse | PatientVisitResponse,
    operation_id="getAppointmentVisit",
)
async def get_visit(
    appointment_id: UUID,
    request: Request,
    actor: ActorContext = Depends(require_role("patient", "doctor")),
    session: AsyncSession = Depends(get_session),
) -> VisitResponse | PatientVisitResponse:
    body = await _service(session, request).get_visit(actor, appointment_id)
    if actor.role == "patient":
        return PatientVisitResponse.model_validate(body)
    return VisitResponse.model_validate(body)


@router.post(
    "/appointments/{appointment_id}/visit",
    response_model=VisitResponse,
    operation_id="openAppointmentVisit",
)
async def open_visit(
    appointment_id: UUID,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("doctor")),
    session: AsyncSession = Depends(get_session),
) -> VisitResponse:
    return VisitResponse.model_validate(
        await _service(session, request).open_visit(actor, appointment_id, idempotency_key)
    )


@router.patch("/visits/{visit_id}", response_model=VisitResponse, operation_id="updateVisit")
async def update_visit(
    visit_id: UUID,
    payload: VisitUpdateRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("doctor")),
    session: AsyncSession = Depends(get_session),
) -> VisitResponse:
    return VisitResponse.model_validate(
        await _service(session, request).update_visit(actor, visit_id, payload)
    )


@router.post(
    "/visits/{visit_id}/complete", response_model=VisitResponse, operation_id="completeVisit"
)
async def complete_visit(
    visit_id: UUID,
    payload: VisitCompleteRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("doctor")),
    session: AsyncSession = Depends(get_session),
) -> VisitResponse:
    return VisitResponse.model_validate(
        await _service(session, request).complete_visit(actor, visit_id, payload, idempotency_key)
    )


@router.post(
    "/visits/{visit_id}/amendments", response_model=VisitResponse, operation_id="amendVisit"
)
async def amend_visit(
    visit_id: UUID,
    payload: VisitAmendmentRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("doctor")),
    session: AsyncSession = Depends(get_session),
) -> VisitResponse:
    return VisitResponse.model_validate(
        await _service(session, request).amend_visit(actor, visit_id, payload, idempotency_key)
    )


@router.get(
    "/me/reminder-preferences",
    response_model=ReminderPreferencesResponse,
    operation_id="getReminderPreferences",
)
async def get_reminder_preferences(
    request: Request,
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> ReminderPreferencesResponse:
    return ReminderPreferencesResponse.model_validate(
        await _service(session, request).get_reminder_preferences(actor)
    )


@router.put(
    "/me/reminder-preferences",
    response_model=ReminderPreferencesResponse,
    operation_id="updateReminderPreferences",
)
async def update_reminder_preferences(
    payload: ReminderPreferencesRequest,
    request: Request,
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> ReminderPreferencesResponse:
    return ReminderPreferencesResponse.model_validate(
        await _service(session, request).update_reminder_preferences(actor, payload)
    )


@router.get(
    "/prescriptions/{prescription_id}/reminder-schedule",
    response_model=ReminderScheduleResponse,
    operation_id="getReminderSchedule",
)
async def get_reminder_schedule(
    prescription_id: UUID,
    request: Request,
    limit: int = Query(default=100, ge=1, le=365),
    actor: ActorContext = Depends(require_role("patient", "doctor")),
    session: AsyncSession = Depends(get_session),
) -> ReminderScheduleResponse:
    return ReminderScheduleResponse.model_validate(
        await _service(session, request).reminder_schedule(actor, prescription_id, limit)
    )


@router.get(
    "/appointments/{appointment_id}/integrations",
    response_model=IntegrationListResponse,
    operation_id="getAppointmentIntegrations",
)
async def get_appointment_integrations(
    appointment_id: UUID,
    request: Request,
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> IntegrationListResponse:
    return IntegrationListResponse(
        items=[
            IntegrationStatusResponse.model_validate(item)
            for item in await _service(session, request).appointment_integrations(
                actor, appointment_id
            )
        ]
    )


@router.get(
    "/admin/integrations",
    response_model=IntegrationListResponse,
    operation_id="listIntegrationOperations",
)
async def list_integrations(
    request: Request,
    state: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> IntegrationListResponse:
    return IntegrationListResponse(
        items=[
            IntegrationStatusResponse.model_validate(item)
            for item in await _service(session, request).admin_integrations(
                state=state, channel=channel
            )
        ]
    )


@router.post(
    "/admin/integrations/{operation_id}/retry",
    response_model=IntegrationStatusResponse,
    operation_id="retryIntegrationOperation",
)
async def retry_integration(
    operation_id: UUID,
    payload: IntegrationRetryRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    actor: ActorContext = Depends(require_role("admin")),
    session: AsyncSession = Depends(get_session),
) -> IntegrationStatusResponse:
    return IntegrationStatusResponse.model_validate(
        await _service(session, request).retry_integration(
            actor, operation_id, payload, idempotency_key
        )
    )
