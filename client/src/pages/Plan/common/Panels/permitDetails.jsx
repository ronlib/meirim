import { useTheme } from '@material-ui/styles';
import PropTypes from 'prop-types';
import React from 'react';
import { TabBox, TabPanel, Typography } from 'shared';
import * as SC from './style';
import styled from 'styled-components';

const formatDate = (isoString) => {
	if (!isoString) return null;
	const d = new Date(isoString);
	if (isNaN(d.getTime())) return null;
	return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
};

const PERMIT_STAGES = [
	'בתהליך היתר',
	'קיים היתר',
	'בבניה',
	'קיימת לפחות תעודת גמר אחת',
	'קיים אכלוס',
];

const PermitDetailsPanel = ({ permitData, url }) => {
	const theme = useTheme();

	if (!permitData) return null;

	const {
		stage,
		stageOrder,
		requestNumber,
		permitNumber,
		address,
		housingUnits,
		requestType,
		requestContent,
		licensingTrack,
		tama38,
		requestOpenedAt,
		permitGrantedAt,
		constructionStartedAt,
	} = permitData;

	return (
		<TabPanel>
			<TabBox>
				<SC.PlanSummaryTitleWrapper>
					<Typography
						variant="planDetailTitle"
						mobileVariant="planDetailTitle"
						component="h2"
						color={theme.palette.black}
					>
						פרטי היתר הבנייה
					</Typography>
				</SC.PlanSummaryTitleWrapper>

				{stage && (
					<DetailRow>
						<DetailLabel theme={theme}>שלב:</DetailLabel>
						<DetailValue theme={theme}>{stage}</DetailValue>
					</DetailRow>
				)}

				{stageOrder != null && (
					<StageProgress>
						{PERMIT_STAGES.map((s, i) => (
							<StageStep key={s} active={i <= stageOrder} current={i === stageOrder}>
								<StepDot active={i <= stageOrder} current={i === stageOrder} />
								<StepLabel active={i <= stageOrder}>{s}</StepLabel>
							</StageStep>
						))}
					</StageProgress>
				)}

				{requestNumber && (
					<DetailRow>
						<DetailLabel theme={theme}>מספר בקשה:</DetailLabel>
						<DetailValue theme={theme}>{requestNumber}</DetailValue>
					</DetailRow>
				)}

				{permitNumber && (
					<DetailRow>
						<DetailLabel theme={theme}>מספר היתר:</DetailLabel>
						<DetailValue theme={theme}>{permitNumber}</DetailValue>
					</DetailRow>
				)}

				{address && (
					<DetailRow>
						<DetailLabel theme={theme}>כתובת:</DetailLabel>
						<DetailValue theme={theme}>{address}</DetailValue>
					</DetailRow>
				)}

				{requestType && (
					<DetailRow>
						<DetailLabel theme={theme}>סוג בקשה:</DetailLabel>
						<DetailValue theme={theme}>{requestType}</DetailValue>
					</DetailRow>
				)}

				{licensingTrack && (
					<DetailRow>
						<DetailLabel theme={theme}>מסלול רישוי:</DetailLabel>
						<DetailValue theme={theme}>{licensingTrack}</DetailValue>
					</DetailRow>
				)}

				{housingUnits > 0 && (
					<DetailRow>
						<DetailLabel theme={theme}>יחידות דיור:</DetailLabel>
						<DetailValue theme={theme}>{housingUnits}</DetailValue>
					</DetailRow>
				)}

				{tama38 && tama38.applies && (
					<DetailRow>
						<DetailLabel theme={theme}>תמ&quot;א 38:</DetailLabel>
						<DetailValue theme={theme}>
							{tama38.isNew ? 'בנייה חדשה' : tama38.isAddition ? 'תוספת' : 'כן'}
						</DetailValue>
					</DetailRow>
				)}

				{requestContent && (
					<DetailRow>
						<DetailLabel theme={theme}>תוכן בקשה:</DetailLabel>
						<DetailValue theme={theme}>{requestContent}</DetailValue>
					</DetailRow>
				)}

				<DatesSection>
					<Typography
						variant="paragraphText"
						mobileVariant="paragraphText"
						component="h3"
						color={theme.palette.black}
						style={{ fontWeight: 600, marginBottom: '0.5rem' }}
					>
						ציר זמן
					</Typography>

					{formatDate(requestOpenedAt) && (
						<DateRow>
							<DateDot />
							<DateContent>
								<DateLabel theme={theme}>פתיחת בקשה</DateLabel>
								<DateValue theme={theme}>{formatDate(requestOpenedAt)}</DateValue>
							</DateContent>
						</DateRow>
					)}

					{formatDate(permitGrantedAt) && (
						<DateRow>
							<DateDot granted />
							<DateContent>
								<DateLabel theme={theme}>מתן היתר</DateLabel>
								<DateValue theme={theme}>{formatDate(permitGrantedAt)}</DateValue>
							</DateContent>
						</DateRow>
					)}

					{formatDate(constructionStartedAt) && (
						<DateRow>
							<DateDot />
							<DateContent>
								<DateLabel theme={theme}>תחילת בנייה</DateLabel>
								<DateValue theme={theme}>{formatDate(constructionStartedAt)}</DateValue>
							</DateContent>
						</DateRow>
					)}
				</DatesSection>

				{url && (
					<SC.UrlWrapper>
						<a target="_blank" rel="noopener noreferrer" href={url}>מסמכי ההיתר</a>
						<SC.CustomLinkIcon />
					</SC.UrlWrapper>
				)}
			</TabBox>
		</TabPanel>
	);
};

PermitDetailsPanel.propTypes = {
	permitData: PropTypes.object,
	url: PropTypes.string,
};

export default PermitDetailsPanel;

const DetailRow = styled.div`
	display: flex;
	flex-wrap: wrap;
	margin-bottom: 0.5rem;
	padding: 0 0.5rem;
`;

const DetailLabel = styled.span`
	font-size: 16px;
	color: ${({ theme }) => theme.palette.gray?.main || '#666'};
	margin-left: 0.5rem;
`;

const DetailValue = styled.span`
	font-size: 16px;
	color: ${({ theme }) => theme.palette.black};
	font-weight: 500;
`;

const StageProgress = styled.div`
	display: flex;
	flex-direction: column;
	margin: 1rem 0.5rem 1.5rem;
	position: relative;
`;

const StageStep = styled.div`
	display: flex;
	align-items: center;
	margin-bottom: 0.75rem;
	position: relative;
`;

const StepDot = styled.div`
	width: 12px;
	height: 12px;
	border-radius: 50%;
	margin-left: 0.75rem;
	flex-shrink: 0;
	background: ${({ active, current }) =>
		current ? '#E65100' : active ? '#4CAF50' : '#E0E0E0'};
	box-shadow: ${({ current }) => current ? '0 0 0 3px rgba(230, 81, 0, 0.2)' : 'none'};
`;

const StepLabel = styled.span`
	font-size: 14px;
	color: ${({ active }) => active ? '#333' : '#999'};
	font-weight: ${({ active }) => active ? 500 : 400};
`;

const DatesSection = styled.div`
	margin-top: 1.5rem;
	padding: 0 0.5rem;
`;

const DateRow = styled.div`
	display: flex;
	align-items: flex-start;
	margin-bottom: 0.75rem;
`;

const DateDot = styled.div`
	width: 10px;
	height: 10px;
	border-radius: 50%;
	margin-left: 0.75rem;
	margin-top: 4px;
	flex-shrink: 0;
	background: ${({ granted }) => granted ? '#E65100' : '#1976D2'};
`;

const DateContent = styled.div`
	display: flex;
	flex-direction: column;
`;

const DateLabel = styled.span`
	font-size: 14px;
	color: ${({ theme }) => theme.palette.gray?.main || '#666'};
`;

const DateValue = styled.span`
	font-size: 16px;
	color: ${({ theme }) => theme.palette.black};
	font-weight: 500;
`;
