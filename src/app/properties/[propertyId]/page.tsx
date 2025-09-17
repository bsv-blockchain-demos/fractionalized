import { PropertyDetails } from "../../../components/property-details";

export default function PropertyDetailsPage({ params }: { params: { propertyId: string } }) {
    return (
        <div>
            <PropertyDetails propertyId={params.propertyId} />
        </div>
    );
}
    